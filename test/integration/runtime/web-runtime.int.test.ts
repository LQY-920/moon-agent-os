// test/integration/runtime/web-runtime.int.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import type { Express } from 'express';
import { startTestDb } from '../setup';
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/core/db';
import { buildApp } from '../../../src/main';
import { PasswordService } from '../../../src/modules/identity/services/password.service';

let app: Express;
let db: Kysely<Database>;
let userId: string;
let cookie: string;
let artifactId: string;
let publicArtifactId: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;

  // Set env for app
  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.PORT = '3001';
  process.env.DATABASE_URL = ctx.container.getUsername() && ctx.container.getHost()
    ? `mysql://root:root@${ctx.container.getHost()}:${ctx.container.getPort()}/moon_test`
    : ctx.container.getConnectionUri();
  process.env.SESSION_COOKIE_NAME = 'mao_sess';
  process.env.SESSION_MAX_AGE_DAYS = '30';
  process.env.SESSION_SLIDING_UPDATE_MINUTES = '1';
  process.env.RATE_LIMIT_IP_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_IP_MAX = '1000';
  process.env.RATE_LIMIT_EMAIL_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_EMAIL_MAX = '1000';
  process.env.LOG_LEVEL = 'warn';
  process.env.LLM_API_KEY = 'sk-test';
  process.env.LLM_MODEL = 'test-model';

  const { buildApp: build } = await import('../../../src/main');
  const built = await build();
  app = built.app;

  // Seed user
  userId = ulid();
  const passwordService = new PasswordService();
  const passwordHash = await passwordService.hash('testpassword');
  await db.insertInto('users').values({
    id: userId,
    email: `runtime-test-${userId}@example.com`,
    email_verified: 0,
    password_hash: passwordHash,
    display_name: 'Runtime Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();

  // Login
  const login = await request(app).post('/api/auth/login').send({
    email: `runtime-test-${userId}@example.com`,
    password: 'testpassword',
  });
  const cookies = login.headers['set-cookie'] as string[] | undefined;
  cookie = cookies ? cookies[0] : '';
}, 120_000);

afterAll(async () => {
  if (app && db) {
    await db.deleteFrom('artifacts').where('user_id', '=', userId).execute();
    await db.deleteFrom('sessions').where('user_id', '=', userId).execute();
    await db.deleteFrom('users').where('id', '=', userId).execute();
  }
  if (cleanup) await cleanup();
}, 60_000);

beforeEach(async () => {
  await db.deleteFrom('artifacts').where('user_id', '=', userId).execute();

  // Create private test artifact
  artifactId = ulid();
  await db.insertInto('artifacts').values({
    id: artifactId,
    user_id: userId,
    kind: 'web',
    title: 'Test Private App',
    payload: JSON.stringify({
      entryHtml: '<h1>Hello from private artifact</h1><button onclick="alert(1)">Click</button>',
      assets: {},
    }),
    status: 'ready',
    origin: 'user_intent',
    visibility: 'private',
    created_at: new Date(),
  }).execute();

  // Create public test artifact
  publicArtifactId = ulid();
  await db.insertInto('artifacts').values({
    id: publicArtifactId,
    user_id: userId,
    kind: 'web',
    title: 'Test Public App',
    payload: JSON.stringify({
      entryHtml: '<h1>Hello from public artifact</h1>',
      assets: {},
    }),
    status: 'ready',
    origin: 'user_intent',
    visibility: 'public',
    created_at: new Date(),
  }).execute();
});

describe('GET /app/:artifactId', () => {
  it('returns 200 with iframe for public artifact (no auth needed)', async () => {
    const r = await request(app).get(`/app/${publicArtifactId}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('<iframe');
    expect(r.text).toContain('srcdoc=');
    expect(r.text).toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it('returns 302 redirect to /login for private artifact without session', async () => {
    const r = await request(app).get(`/app/${artifactId}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain('/login');
  });

  it('returns 200 with iframe for authenticated owner of private artifact', async () => {
    const r = await request(app).get(`/app/${artifactId}`).set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.text).toContain('<iframe');
    expect(r.text).toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it('renders entryHtml in srcdoc', async () => {
    const r = await request(app).get(`/app/${publicArtifactId}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Hello from public artifact');
  });

  it('returns 404 for non-existent artifact', async () => {
    const r = await request(app).get(`/app/${ulid()}`).set('Cookie', cookie);
    expect(r.status).toBe(404);
  });

  it('shows correct visibility badge', async () => {
    const privateR = await request(app).get(`/app/${artifactId}`).set('Cookie', cookie);
    expect(privateR.text).toContain('🔒 私密');

    const publicR = await request(app).get(`/app/${publicArtifactId}`);
    expect(publicR.text).toContain('🔓 公开');
  });
});

describe('PATCH /api/artifacts/:artifactId', () => {
  it('updates visibility to public', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'public' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.visibility).toBe('public');
  });

  it('allows unauthenticated access to now-public artifact', async () => {
    // First make it public
    await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'public' });

    // Now access without auth
    const r = await request(app).get(`/app/${artifactId}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('🔓 公开');
  });

  it('updates visibility back to private', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'private' });
    expect(r.status).toBe(200);
    expect(r.body.visibility).toBe('private');
  });

  it('returns 400 for invalid visibility value', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'invalid' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 without authentication', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .send({ visibility: 'public' });
    expect(r.status).toBe(401);
  });
});
