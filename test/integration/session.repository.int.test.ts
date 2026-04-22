import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ulid } from 'ulid';
import { startTestDb, type TestDbCtx } from './setup';
import { UserRepository } from '../../src/modules/identity/repositories/user.repository';
import { SessionRepository } from '../../src/modules/identity/repositories/session.repository';

let ctx: TestDbCtx;
let users: UserRepository;
let sessions: SessionRepository;
let userId: string;

beforeAll(async () => {
  ctx = await startTestDb();
  users = new UserRepository(ctx.db);
  sessions = new SessionRepository(ctx.db);
  userId = ulid();
  await users.insert({
    id: userId, email: 'int@example.com', passwordHash: 'fake-hash',
    displayName: 'Int', now: new Date(),
  });
});

afterAll(async () => {
  await ctx.destroy();
});

describe('SessionRepository (integration)', () => {
  it('insert then find active by token hash', async () => {
    const now = new Date();
    const id = ulid();
    await sessions.insert({
      id, userId, tokenHash: 'a'.repeat(64),
      userAgent: 'UA', ip: '1.1.1.1',
      now, expiresAt: new Date(now.getTime() + 86_400_000),
    });
    const s = await sessions.findActiveByTokenHash('a'.repeat(64));
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(userId);
  });

  it('revoked session is not found as active', async () => {
    const now = new Date();
    const id = ulid();
    await sessions.insert({
      id, userId, tokenHash: 'b'.repeat(64),
      userAgent: null, ip: null, now, expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await sessions.revokeById(id, new Date());
    const s = await sessions.findActiveByTokenHash('b'.repeat(64));
    expect(s).toBeNull();
  });

  it('deleteStale removes expired rows', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    await sessions.insert({
      id: ulid(), userId, tokenHash: 'c'.repeat(64),
      userAgent: null, ip: null, now: old, expiresAt: old,
    });
    const before = new Date(Date.now() - 90 * 86_400_000);
    const deleted = await sessions.deleteStale(before);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
