import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cron, { type ScheduledTask } from 'node-cron';
import { loadConfig } from './core/config';
import { createLogger } from './core/logger';
import { createDb } from './core/db';
import { requestId } from './middleware/request-id';
import { errorHandler } from './middleware/error-handler';
import { requireSession } from './middleware/require-session';
import { buildLoginRateLimiters } from './middleware/rate-limit';
import { UserRepository } from './modules/identity/repositories/user.repository';
import { IdentityRepository } from './modules/identity/repositories/identity.repository';
import { SessionRepository } from './modules/identity/repositories/session.repository';
import { LoginAttemptRepository } from './modules/identity/repositories/login-attempt.repository';
import { PasswordService } from './modules/identity/services/password.service';
import { SessionService } from './modules/identity/services/session.service';
import { AuthService } from './modules/identity/services/auth.service';
import { AuthController } from './modules/identity/controllers/auth.controller';
import { MeController } from './modules/identity/controllers/me.controller';
import { buildIdentityRoutes } from './modules/identity/routes';
import { authEvents } from './modules/identity/events';
import { ConversationRepository } from './modules/memory/repositories/conversation.repository';
import { MessageRepository } from './modules/memory/repositories/message.repository';
import { MemoryService } from './modules/memory/services/memory.service';
import { MemoryController } from './modules/memory/controllers/memory.controller';
import { buildMemoryRoutes } from './modules/memory/routes';
import { InMemoryArtifactSchemaRegistry } from './modules/artifact/registry';
import { WebArtifactPayload } from './modules/artifact/registry/web.schema';
import { ArtifactRepository } from './modules/artifact/repositories/artifact.repository';
import { ArtifactService } from './modules/artifact/services/artifact.service';

export async function buildApp() {
  const cfg = loadConfig();
  const isProd = cfg.nodeEnv === 'production';
  const logger = createLogger(cfg.logLevel, !isProd);
  const { db } = createDb(cfg.databaseUrl);

  const users = new UserRepository(db);
  const identities = new IdentityRepository(db);
  const sessionsRepo = new SessionRepository(db);
  const attempts = new LoginAttemptRepository(db);
  const passwords = new PasswordService();
  const sessions = new SessionService(sessionsRepo, {
    maxAgeDays: cfg.session.maxAgeDays,
    slidingUpdateMinutes: cfg.session.slidingUpdateMinutes,
  });
  const auth = new AuthService(users, identities, attempts, passwords, sessions);

  // S2 memory module
  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  const memoryService = new MemoryService(conversationRepo, messageRepo, db);
  const memoryCtrl = new MemoryController(memoryService);

  // S3.2 artifact module (no HTTP routes; exposed as in-process service for M2+ subsystems)
  const artifactRegistry = new InMemoryArtifactSchemaRegistry();
  artifactRegistry.register('web', WebArtifactPayload);

  const artifactRepo = new ArtifactRepository(db);
  const artifactService = new ArtifactService(artifactRepo, artifactRegistry);

  // artifactService intentionally not used yet — it's the contract center
  // that future S3.1/S3.3/S3.4/S4.1 will consume. Reference it once to avoid
  // TS6133 "declared but never used".
  void artifactService;

  const authCtrl = new AuthController(auth, cfg.session.cookieName, cfg.session.maxAgeDays, isProd);
  const meCtrl = new MeController(users, sessions, auth, cfg.session.cookieName, cfg.session.maxAgeDays, isProd);
  const loginRateLimiters = buildLoginRateLimiters(cfg.rateLimit);

  const safeLog = (name: string) => (ev: unknown) => {
    try { logger.info({ event: ev }, `auth_event.${name}`); } catch { /* 防御 */ }
  };
  const onLoginSuccess = safeLog('login_success');
  const onLoginFailure = safeLog('login_failure');
  const onLogout = safeLog('logout');
  const onSessionRevoked = safeLog('session_revoked');
  const onPasswordChanged = safeLog('password_changed');
  const onUserCreated = safeLog('user_created');
  authEvents.on('login_success', onLoginSuccess);
  authEvents.on('login_failure', onLoginFailure);
  authEvents.on('logout', onLogout);
  authEvents.on('session_revoked', onSessionRevoked);
  authEvents.on('password_changed', onPasswordChanged);
  authEvents.on('user_created', onUserCreated);

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(requestId());
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => { res.status(200).json({ ok: true }); });

  app.use('/api', buildIdentityRoutes({
    authCtrl, meCtrl,
    requireSession: requireSession(sessions, cfg.session.cookieName),
    loginRateLimiters,
  }));

  app.use('/api/memory', buildMemoryRoutes({
    memoryCtrl,
    requireSession: requireSession(sessions, cfg.session.cookieName),
  }));

  app.use(errorHandler(logger));

  let cronTask: ScheduledTask | null = null;
  if (cfg.nodeEnv !== 'test') {
    cronTask = cron.schedule('0 3 * * *', async () => {
      const now = new Date();
      const sessionCutoff = new Date(now.getTime() - 30 * 86_400_000);
      const attemptCutoff = new Date(now.getTime() - 90 * 86_400_000);
      const sDeleted = await sessionsRepo.deleteStale(sessionCutoff);
      const aDeleted = await attempts.deleteOlderThan(attemptCutoff);
      logger.info({ sessionsDeleted: sDeleted, attemptsDeleted: aDeleted }, 'cron_cleanup');
    });
  }

  async function shutdown() {
    if (cronTask) cronTask.stop();
    authEvents.off('login_success', onLoginSuccess);
    authEvents.off('login_failure', onLoginFailure);
    authEvents.off('logout', onLogout);
    authEvents.off('session_revoked', onSessionRevoked);
    authEvents.off('password_changed', onPasswordChanged);
    authEvents.off('user_created', onUserCreated);
    // Kysely's MysqlDialect.destroy() internally awaits pool.end(); no separate call needed.
    await db.destroy();
  }

  return { app, shutdown, logger, cfg };
}

async function main() {
  const { app, logger, cfg } = await buildApp();
  const server = app.listen(cfg.port, () => {
    logger.info({ port: cfg.port }, 'server_started');
  });
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('bootstrap failed:', err);
    process.exit(1);
  });
}
