import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let repo: ConversationRepository;
let userId: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  repo = new ConversationRepository(db);
  cleanup = ctx.destroy;

  // Insert a user as FK target
  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `mem-test-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Mem Tester',
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
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
});

describe('ConversationRepository', () => {
  it('inserts and findById round-trips', async () => {
    const id = ulid();
    const now = new Date('2026-04-23T10:00:00.000Z');
    await repo.insert({ id, userId, title: 'hello', now });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('hello');
    expect(found!.userId).toBe(userId);
  });

  it('listByUser orders by updated_at DESC with stable id tiebreaker', async () => {
    const t1 = new Date('2026-04-23T10:00:00.000Z');
    const t2 = new Date('2026-04-23T11:00:00.000Z');
    // Use fixed IDs with known ordering (for test predictability)
    const idA = '00000000000000000000000001'; // smallest
    const idB = '00000000000000000000000002'; // middle
    const idC = '00000000000000000000000003'; // largest

    await repo.insert({ id: idA, userId, title: 'A', now: t1 });
    await repo.insert({ id: idB, userId, title: 'B', now: t2 });
    await repo.insert({ id: idC, userId, title: 'C', now: t2 });

    const r = await repo.listByUser(userId, { limit: 10 });
    // ORDER BY updated_at DESC, id DESC
    // Same t2: id DESC means C > B > A (largest first)
    const titles = r.items.map(c => c.title);
    expect(titles[0]).toBe('C'); // idC > idB so C first
    expect(titles[1]).toBe('B');
    expect(titles[2]).toBe('A');
    expect(r.nextCursor).toBeNull();
  });

  it('listByUser paginates with cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.insert({ id: ulid(), userId, title: `c${i}`, now: new Date(Date.now() + i * 1000) });
    }
    const p1 = await repo.listByUser(userId, { limit: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await repo.listByUser(userId, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.length).toBe(2);
    const ids1 = new Set(p1.items.map((c) => c.id));
    for (const c of p2.items) expect(ids1.has(c.id)).toBe(false);

    const p3 = await repo.listByUser(userId, { limit: 2, cursor: p2.nextCursor });
    expect(p3.items.length).toBe(1);
    expect(p3.nextCursor).toBeNull();
  });

  it('touchUpdatedAt actually updates the timestamp', async () => {
    const id = ulid();
    const t0 = new Date('2026-04-23T10:00:00.000Z');
    await repo.insert({ id, userId, title: null, now: t0 });
    const t1 = new Date('2026-04-23T12:00:00.000Z');
    await repo.touchUpdatedAt(id, t1);
    const back = await repo.findById(id);
    expect(back!.updatedAt.toISOString()).toBe(t1.toISOString());
    expect(back!.createdAt.toISOString()).toBe(t0.toISOString());
  });

  it('deleteById removes the row', async () => {
    const id = ulid();
    await repo.insert({ id, userId, title: null, now: new Date() });
    await repo.deleteById(id);
    expect(await repo.findById(id)).toBeNull();
  });
});
