import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { MessageRepository } from '../../../src/modules/memory/repositories/message.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let convRepo: ConversationRepository;
let msgRepo: MessageRepository;
let userId: string;
let conversationId: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  convRepo = new ConversationRepository(db);
  msgRepo = new MessageRepository(db);
  cleanup = ctx.destroy;

  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `msg-test-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Msg Tester',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await cleanup();
});

beforeEach(async () => {
  // Fresh conversation per test
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
  conversationId = ulid();
  await convRepo.insert({ id: conversationId, userId, title: null, now: new Date() });
});

describe('MessageRepository', () => {
  it('insert + listByConversation returns messages in ASC time order', async () => {
    const t1 = new Date('2026-04-23T10:00:00.000Z');
    const t2 = new Date('2026-04-23T10:01:00.000Z');
    const t3 = new Date('2026-04-23T10:02:00.000Z');
    await msgRepo.insert({ id: ulid(), conversationId, role: 'user', content: 'hi', now: t1 });
    await msgRepo.insert({ id: ulid(), conversationId, role: 'ai', content: 'hello', now: t2 });
    await msgRepo.insert({ id: ulid(), conversationId, role: 'user', content: 'bye', now: t3 });

    const r = await msgRepo.listByConversation(conversationId, { limit: 10 });
    expect(r.items.map((m) => m.content)).toEqual(['hi', 'hello', 'bye']);
    expect(r.nextCursor).toBeNull();
  });

  it('cursor pagination: second page continues from where first ended', async () => {
    for (let i = 0; i < 5; i++) {
      await msgRepo.insert({
        id: ulid(), conversationId, role: 'user', content: `m${i}`,
        now: new Date(Date.now() + i * 1000),
      });
    }
    const p1 = await msgRepo.listByConversation(conversationId, { limit: 2 });
    expect(p1.items.length).toBe(2);
    const p2 = await msgRepo.listByConversation(conversationId, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.length).toBe(2);
    const p1Ids = new Set(p1.items.map((m) => m.id));
    for (const m of p2.items) expect(p1Ids.has(m.id)).toBe(false);
  });

  it('FK CASCADE: deleting conversation removes its messages', async () => {
    await msgRepo.insert({ id: ulid(), conversationId, role: 'user', content: 'x', now: new Date() });
    await msgRepo.insert({ id: ulid(), conversationId, role: 'ai', content: 'y', now: new Date() });

    await convRepo.deleteById(conversationId);

    const count = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ${conversationId}
    `.execute(db);
    expect(Number(count.rows[0].n)).toBe(0);
  });

  it('insert uses optional tx executor when given', async () => {
    const id1 = ulid(), id2 = ulid();
    await db.transaction().execute(async (tx) => {
      await msgRepo.insert({ id: id1, conversationId, role: 'user', content: 'a', now: new Date() }, tx);
      await msgRepo.insert({ id: id2, conversationId, role: 'ai', content: 'b', now: new Date() }, tx);
    });
    const r = await msgRepo.listByConversation(conversationId, { limit: 10 });
    expect(r.items.length).toBe(2);
  });
});