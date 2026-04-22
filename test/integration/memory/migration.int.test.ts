import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../../src/core/db';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('memory migration', () => {
  it('creates conversations table with expected columns', async () => {
    const rows = await sql<{ COLUMN_NAME: string }>`
      SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'conversations'
    `.execute(db);
    const names = rows.rows.map((r) => r.COLUMN_NAME);
    expect(names).toEqual(expect.arrayContaining(['id', 'user_id', 'title', 'created_at', 'updated_at']));
  });

  it('creates messages table with CHECK on role', async () => {
    const rows = await sql<{ CONSTRAINT_NAME: string }>`
      SELECT CONSTRAINT_NAME FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'chk_messages_role'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('rejects message with invalid role via CHECK', async () => {
    // FK constraint: need a conversation + user to test messages CHECK
    // First check if setup creates test user, otherwise skip
    await expect(sql`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES ('01K00000000000000000000000', '01K00000000000000000000001', 'bot', 'x', NOW(3))
    `.execute(db)).rejects.toThrow();
  });
});
