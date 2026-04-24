import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { Kysely, MysqlDialect, Migrator, FileMigrationProvider } from 'kysely';
import { createPool } from 'mysql2';
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Express } from 'express';
import type { Database } from '../../src/core/db';

let container: StartedMySqlContainer;
let app: Express;
let shutdown: () => Promise<void>;
let cookie: string;

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8').withDatabase('moon_e2e').withRootPassword('root').start();
  const url = `mysql://root:root@${container.getHost()}:${container.getPort()}/moon_e2e`;

  // Run migrations in a throwaway Kysely instance, then close.
  const pool = createPool({ uri: url, connectionLimit: 5 });
  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });
  const migrationFolder = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const pathShim = {
    ...nodePath,
    join: (...parts: string[]) => pathToFileURL(nodePath.join(...parts)).href,
  };
  const migrator = new Migrator({ db, provider: new FileMigrationProvider({ fs, path: pathShim, migrationFolder }) });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
  await db.destroy();

  // Set env for buildApp.
  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.PORT = '3001';
  process.env.DATABASE_URL = url;
  process.env.SESSION_COOKIE_NAME = 'mao_sess';
  process.env.SESSION_MAX_AGE_DAYS = '30';
  process.env.SESSION_SLIDING_UPDATE_MINUTES = '1';
  process.env.RATE_LIMIT_IP_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_IP_MAX = '1000';
  process.env.RATE_LIMIT_EMAIL_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_EMAIL_MAX = '1000';
  process.env.LOG_LEVEL = 'warn';
  process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? 'sk-ec48a60426294af590c2cc12518f27a8';
  process.env.LLM_MODEL = process.env.LLM_MODEL ?? 'deepseek-v4-pro';

  const { buildApp } = await import('../../src/main');
  const built = await buildApp();
  app = built.app;
  shutdown = built.shutdown;

  // Seed an account via AuthService directly.
  const { AuthService } = await import('../../src/modules/identity/services/auth.service');
  const { UserRepository } = await import('../../src/modules/identity/repositories/user.repository');
  const { IdentityRepository } = await import('../../src/modules/identity/repositories/identity.repository');
  const { LoginAttemptRepository } = await import('../../src/modules/identity/repositories/login-attempt.repository');
  const { SessionRepository } = await import('../../src/modules/identity/repositories/session.repository');
  const { SessionService } = await import('../../src/modules/identity/services/session.service');
  const { PasswordService } = await import('../../src/modules/identity/services/password.service');
  const pool2 = createPool({ uri: url, connectionLimit: 2 });
  const db2 = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool2 }) });
  const passwords = new PasswordService();
  const sessions = new SessionService(new SessionRepository(db2), { maxAgeDays: 30, slidingUpdateMinutes: 1 });
  const svc = new AuthService(
    new UserRepository(db2),
    new IdentityRepository(db2),
    new LoginAttemptRepository(db2),
    passwords,
    sessions,
  );
  await svc.register({
    email: 'e2e@example.com', password: 'E2e-Secret-Passcode-!!', displayName: 'E2E', via: 'cli', now: new Date(),
  });
  await db2.destroy();

  // Pre-login to reuse cookie across tests
  const login = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Secret-Passcode-!!' });
  expect(login.status).toBe(200);
  cookie = login.headers['set-cookie'];
}, 120_000);

afterAll(async () => {
  await shutdown();
  await container.stop();
}, 60_000);

describe('Intent API', () => {
  it('returns 401 without cookie', async () => {
    const r = await request(app).post('/api/intent/sessions').send({});
    expect(r.status).toBe(401);
  });

  it('creates session and returns sessionId', async () => {
    const r = await request(app).post('/api/intent/sessions').set('Cookie', cookie).send({});
    expect(r.status).toBe(201);
    expect(r.body.sessionId).toBeDefined();
    expect(r.body.sessionId.length).toBe(26);
    expect(r.body.userId).toBeDefined();
  });

  it('sends message and returns LLM response (clarifying or triggered)', async () => {
    const create = await request(app).post('/api/intent/sessions').set('Cookie', cookie).send({});
    expect(create.status).toBe(201);
    const sessionId = create.body.sessionId;

    const r = await request(app)
      .post(`/api/intent/sessions/${sessionId}/messages`)
      .set('Cookie', cookie)
      .send({ message: '我要做一个记账 app' });
    expect(r.status).toBe(200);
    expect(r.body.message).toBeDefined();
    expect(r.body.status).toBeOneOf(['clarifying', 'triggered']);
  });

  it('rejects empty message with 400', async () => {
    const create = await request(app).post('/api/intent/sessions').set('Cookie', cookie).send({});
    expect(create.status).toBe(201);
    const sessionId = create.body.sessionId;

    const r = await request(app)
      .post(`/api/intent/sessions/${sessionId}/messages`)
      .set('Cookie', cookie)
      .send({ message: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});
