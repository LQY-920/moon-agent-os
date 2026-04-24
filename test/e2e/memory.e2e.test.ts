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

// 两个独立用户 + 他们的登录 cookie
let userA: { email: string; password: string; cookie: string };
let userB: { email: string; password: string; cookie: string };

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
  process.env.LLM_API_KEY = process.env.LLM_API_KEY ?? 'sk-ant-test';
  process.env.LLM_MODEL = process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514';

  const { buildApp } = await import('../../src/main');
  const built = await buildApp();
  app = built.app;
  shutdown = built.shutdown;

  // Seed accounts via AuthService directly.
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

  const mkUser = async (email: string) => {
    const password = 'CorrectHorseBatteryStaple9!';
    await svc.register({
      email, password, displayName: email.split('@')[0], via: 'cli', now: new Date(),
    });
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const rawCookie = login.headers['set-cookie'][0];
    return { email, password, cookie: rawCookie };
  };
  userA = await mkUser('a@mem.test');
  userB = await mkUser('b@mem.test');
  await db2.destroy();
}, 180_000);

afterAll(async () => {
  await shutdown();
  await container.stop();
}, 60_000);

describe('Memory API · authentication', () => {
  it('returns 401 UNAUTHENTICATED when no cookie is supplied', async () => {
    const r = await request(app).get('/api/memory/conversations');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('Memory API · conversation CRUD golden path', () => {
  it('creates, lists, reads, and deletes a conversation', async () => {
    const create = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie)
      .send({ title: 'first' });
    expect(create.status).toBe(201);
    expect(create.body.title).toBe('first');
    const id = create.body.id;

    const get = await request(app).get(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(id);

    const list = await request(app).get('/api/memory/conversations')
      .set('Cookie', userA.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);

    const del = await request(app).delete(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });
});

describe('Memory API · messages + updated_at', () => {
  it('appending a message updates conversation.updated_at', async () => {
    const created = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({ title: 't' });
    const id = created.body.id;
    const baseUpdated = created.body.updatedAt;

    // small delay to guarantee tick
    await new Promise((r) => setTimeout(r, 10));

    const add = await request(app).post(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie)
      .send({ role: 'user', content: 'hello' });
    expect(add.status).toBe(201);
    expect(add.body.role).toBe('user');
    expect(add.body.content).toBe('hello');

    const reread = await request(app).get(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(new Date(reread.body.updatedAt).getTime())
      .toBeGreaterThan(new Date(baseUpdated).getTime());
  });

  it('lists messages in ASC order', async () => {
    const created = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({});
    const id = created.body.id;
    for (const c of ['one', 'two', 'three']) {
      await request(app).post(`/api/memory/conversations/${id}/messages`)
        .set('Cookie', userA.cookie)
        .send({ role: 'user', content: c });
    }
    const list = await request(app).get(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: any) => m.content)).toEqual(['one', 'two', 'three']);
  });
});

describe('Memory API · cross-user isolation', () => {
  let aConvId: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie)
      .send({ title: 'private' });
    aConvId = r.body.id;
  });

  it('userB gets 403 when reading userA conversation', async () => {
    const r = await request(app).get(`/api/memory/conversations/${aConvId}`)
      .set('Cookie', userB.cookie);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CONVERSATION_FORBIDDEN');
  });

  it('userB gets 403 when writing to userA conversation', async () => {
    const r = await request(app).post(`/api/memory/conversations/${aConvId}/messages`)
      .set('Cookie', userB.cookie)
      .send({ role: 'user', content: 'intrude' });
    expect(r.status).toBe(403);
  });

  it('userB gets 403 when deleting userA conversation', async () => {
    const r = await request(app).delete(`/api/memory/conversations/${aConvId}`)
      .set('Cookie', userB.cookie);
    expect(r.status).toBe(403);
  });
});

describe('Memory API · validation', () => {
  it('rejects invalid role with 400 VALIDATION_FAILED', async () => {
    const c = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({});
    const id = c.body.id;
    const r = await request(app).post(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie)
      .send({ role: 'bot', content: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects empty content with 400', async () => {
    const c = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({});
    const id = c.body.id;
    const r = await request(app).post(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie)
      .send({ role: 'user', content: '' });
    expect(r.status).toBe(400);
  });

  it('rejects title > 200 chars with 400', async () => {
    const r = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie)
      .send({ title: 'x'.repeat(201) });
    expect(r.status).toBe(400);
  });
});