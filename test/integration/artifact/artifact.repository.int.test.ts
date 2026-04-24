import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let repo: ArtifactRepository;
let cleanup: () => Promise<void>;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  repo = new ArtifactRepository(db);
  cleanup = ctx.destroy;

  userId = ulid();
  otherUserId = ulid();
  for (const [id, suffix] of [[userId, 'a'], [otherUserId, 'b']] as const) {
    await db.insertInto('users').values({
      id,
      email: `art-${suffix}-${id}@example.com`,
      email_verified: 0,
      password_hash: 'irrelevant',
      display_name: `Art ${suffix}`,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();
  }
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('artifacts').where('user_id', 'in', [userId, otherUserId]).execute();
  await db.deleteFrom('users').where('id', 'in', [userId, otherUserId]).execute();
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('artifacts').where('user_id', 'in', [userId, otherUserId]).execute();
});

describe('ArtifactRepository', () => {
  it('inserts and findById round-trips (incl JSON payload)', async () => {
    const id = ulid();
    const now = new Date('2026-04-24T10:00:00.000Z');
    await repo.insert({
      id, userId, kind: 'web', title: 't',
      payload: { entryHtml: '<x/>', nested: { k: 1 } },
      status: 'ready', origin: 'user_intent',
      parentArtifactId: null, now,
    });

    const back = await repo.findById(id);
    expect(back).not.toBeNull();
    expect(back!.userId).toBe(userId);
    expect(back!.kind).toBe('web');
    expect(back!.status).toBe('ready');
    expect(back!.origin).toBe('user_intent');
    expect(back!.parentArtifactId).toBeNull();
    expect(back!.payload).toEqual({ entryHtml: '<x/>', nested: { k: 1 } });
  });

  it('listByUser returns only the requested user in DESC created_at order', async () => {
    const baseTs = Date.now();
    const idA = ulid(), idB = ulid(), idOther = ulid();
    await repo.insert({ id: idA, userId, kind: 'web', title: 'A', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null,
      now: new Date(baseTs) });
    await repo.insert({ id: idB, userId, kind: 'web', title: 'B', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null,
      now: new Date(baseTs + 1000) });
    await repo.insert({ id: idOther, userId: otherUserId, kind: 'web', title: 'X', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null,
      now: new Date(baseTs + 2000) });

    const r = await repo.listByUser(userId, { limit: 10 });
    expect(r.items.map((a) => a.title)).toEqual(['B', 'A']);
    expect(r.nextCursor).toBeNull();
  });

  it('listByUser filters by kind', async () => {
    await repo.insert({ id: ulid(), userId, kind: 'web', title: 'w', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.insert({ id: ulid(), userId, kind: 'mcp', title: 'm', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });

    const r = await repo.listByUser(userId, { limit: 10, kind: 'web' });
    expect(r.items.length).toBe(1);
    expect(r.items[0].kind).toBe('web');
  });

  it('listByUser filters by status', async () => {
    await repo.insert({ id: ulid(), userId, kind: 'web', title: 'R', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.insert({ id: ulid(), userId, kind: 'web', title: 'X', payload: {},
      status: 'retired', origin: 'user_intent', parentArtifactId: null, now: new Date() });

    const r = await repo.listByUser(userId, { limit: 10, status: 'retired' });
    expect(r.items.length).toBe(1);
    expect(r.items[0].title).toBe('X');
  });

  it('listByUser paginates via cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.insert({ id: ulid(), userId, kind: 'web', title: `c${i}`,
        payload: {}, status: 'ready', origin: 'user_intent',
        parentArtifactId: null, now: new Date(Date.now() + i * 1000) });
    }
    const p1 = await repo.listByUser(userId, { limit: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await repo.listByUser(userId, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.length).toBe(2);

    const ids1 = new Set(p1.items.map((a) => a.id));
    for (const a of p2.items) expect(ids1.has(a.id)).toBe(false);

    const p3 = await repo.listByUser(userId, { limit: 2, cursor: p2.nextCursor });
    expect(p3.items.length).toBe(1);
    expect(p3.nextCursor).toBeNull();
  });

  it('updateStatus changes status', async () => {
    const id = ulid();
    await repo.insert({ id, userId, kind: 'web', title: 't', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.updateStatus(id, 'retired');
    const back = await repo.findById(id);
    expect(back!.status).toBe('retired');
  });

  it('FK user ON DELETE CASCADE: hard-deleting user cascades to artifacts', async () => {
    const throwawayUser = ulid();
    await db.insertInto('users').values({
      id: throwawayUser,
      email: `art-cascade-${throwawayUser}@example.com`,
      email_verified: 0, password_hash: 'x', display_name: 'Cascade',
      status: 'active', created_at: new Date(), updated_at: new Date(),
    }).execute();
    const artId = ulid();
    await repo.insert({ id: artId, userId: throwawayUser, kind: 'web', title: 'c',
      payload: {}, status: 'ready', origin: 'user_intent',
      parentArtifactId: null, now: new Date() });

    await db.deleteFrom('users').where('id', '=', throwawayUser).execute();

    const after = await repo.findById(artId);
    expect(after).toBeNull();
  });

  it('FK parent ON DELETE SET NULL: deleting parent nulls child.parent_artifact_id', async () => {
    const parentId = ulid();
    const childId = ulid();
    await repo.insert({ id: parentId, userId, kind: 'web', title: 'P', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.insert({ id: childId, userId, kind: 'web', title: 'C', payload: {},
      status: 'ready', origin: 'iteration', parentArtifactId: parentId, now: new Date() });

    // hard delete parent directly(绕过 service)
    await db.deleteFrom('artifacts').where('id', '=', parentId).execute();

    const child = await repo.findById(childId);
    expect(child).not.toBeNull();
    expect(child!.parentArtifactId).toBeNull();
  });
});
