import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let cleanup: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;

  // seed a user for FK tests
  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `art-mig-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Art Mig',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('artifact migration', () => {
  it('creates artifacts table with expected columns', async () => {
    const rows = await sql<{ COLUMN_NAME: string }>`
      SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'artifacts'
    `.execute(db);
    const names = rows.rows.map((r) => r.COLUMN_NAME);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'user_id', 'kind', 'title', 'payload',
      'status', 'origin', 'parent_artifact_id', 'created_at',
    ]));
  });

  it('has CHECK constraint on status', async () => {
    const rows = await sql<{ CONSTRAINT_NAME: string }>`
      SELECT CONSTRAINT_NAME FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'chk_artifacts_status'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('has CHECK constraint on origin', async () => {
    const rows = await sql<{ CONSTRAINT_NAME: string }>`
      SELECT CONSTRAINT_NAME FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'chk_artifacts_origin'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('rejects invalid status via CHECK', async () => {
    const artId = ulid();
    await expect(sql`
      INSERT INTO artifacts (id, user_id, kind, title, payload, status, origin, created_at)
      VALUES (${artId}, ${userId}, 'web', 'x', JSON_OBJECT('a', 1), 'invalid', 'user_intent', NOW(3))
    `.execute(db)).rejects.toThrow();
  });

  it('rejects invalid origin via CHECK', async () => {
    const artId = ulid();
    await expect(sql`
      INSERT INTO artifacts (id, user_id, kind, title, payload, status, origin, created_at)
      VALUES (${artId}, ${userId}, 'web', 'x', JSON_OBJECT('a', 1), 'ready', 'invalid-origin', NOW(3))
    `.execute(db)).rejects.toThrow();
  });

  it('accepts ANY kind value (no DB CHECK on kind)', async () => {
    const artId = ulid();
    await expect(sql`
      INSERT INTO artifacts (id, user_id, kind, title, payload, status, origin, created_at)
      VALUES (${artId}, ${userId}, 'some-weird-kind', 'x', JSON_OBJECT('a', 1), 'ready', 'user_intent', NOW(3))
    `.execute(db)).resolves.toBeDefined();
    await db.deleteFrom('artifacts').where('id', '=', artId).execute();   // cleanup
  });
});
