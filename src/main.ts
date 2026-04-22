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

export async function buildApp() {
  const cfg = loadConfig();
  const isProd = cfg.nodeEnv === 'production';
  const logger = createLogger(cfg.logLevel, !isProd);
  const { db, pool } = createDb(cfg.databaseUrl);

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

  const authCtrl = new AuthController(auth, cfg.session.cookieName, cfg.session.maxAgeDays, isProd);
  const meCtrl = new MeController(users, sessions, auth, cfg.session.cookieName, cfg.session.maxAgeDays, isProd);
  const loginRateLimiters = buildLoginRateLimiters(cfg.rateLimit);

  const safeLog = (name: string) => (ev: unknown) => {
    try { logger.info({ event: ev }, `auth_event.${name}`); } catch { /* 防御 */ }
  };
  authEvents.on('login_success', safeLog('login_success'));
  authEvents.on('login_failure', safeLog('login_failure'));
  authEvents.on('logout', safeLog('logout'));
  authEvents.on('session_revoked', safeLog('session_revoked'));
  authEvents.on('password_changed', safeLog('password_changed'));
  authEvents.on('user_created', safeLog('user_created'));

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
    await db.destroy();
    pool.end();
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
