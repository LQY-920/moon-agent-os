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
}, 120_000);

afterAll(async () => {
  await shutdown();
  await container.stop();
}, 60_000);

describe('auth e2e', () => {
  it('login → /me → logout flow', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Secret-Passcode-!!' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const me = await request(app).get('/api/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('e2e@example.com');

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const afterLogout = await request(app).get('/api/me').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('login with wrong password returns 401 INVALID_CREDENTIALS (not leaking email existence)', async () => {
    const res1 = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'wrong-password' });
    expect(res1.status).toBe(401);
    expect(res1.body.error.code).toBe('INVALID_CREDENTIALS');

    const res2 = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(res2.status).toBe(401);
    expect(res2.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('change password revokes all sessions and issues a new one', async () => {
    const loginA = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Secret-Passcode-!!' });
    const cookieA = loginA.headers['set-cookie'];
    const loginB = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Secret-Passcode-!!' });
    const cookieB = loginB.headers['set-cookie'];

    const change = await request(app).post('/api/me/password')
      .set('Cookie', cookieA)
      .send({ oldPassword: 'E2e-Secret-Passcode-!!', newPassword: 'New-Strong-Passcode-!!' });
    expect(change.status).toBe(204);
    const cookieAnew = change.headers['set-cookie'];

    const oldA = await request(app).get('/api/me').set('Cookie', cookieA);
    expect(oldA.status).toBe(401);
    const oldB = await request(app).get('/api/me').set('Cookie', cookieB);
    expect(oldB.status).toBe(401);
    const newA = await request(app).get('/api/me').set('Cookie', cookieAnew);
    expect(newA.status).toBe(200);
  });

  it('revoke someone else session returns 404', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'New-Strong-Passcode-!!' });
    const cookie = login.headers['set-cookie'];
    const res = await request(app).delete('/api/me/sessions/01HXAAAAAAAAAAAAAAAAAAAAAA').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('register endpoint returns 501 NOT_IMPLEMENTED in M0', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'xxx', displayName: 'x' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
