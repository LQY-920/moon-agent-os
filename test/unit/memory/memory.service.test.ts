import { describe, it, expect, vi } from 'vitest';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationNotFoundError, ConversationForbiddenError } from '../../../src/modules/memory/domain/errors';
import type { Conversation } from '../../../src/modules/memory/domain/conversation';

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '01K40A8Y3V9E2XBSG5HMTVKQ11',
    userId: '01K40A8Y3V9E2XBSG5HMTVKQ22',
    title: null,
    createdAt: new Date('2026-04-23T10:00:00.000Z'),
    updatedAt: new Date('2026-04-23T10:00:00.000Z'),
    ...overrides,
  };
}

describe('MemoryService.createConversation', () => {
  it('inserts with ULID id and given userId', async () => {
    const convRepo = {
      insert: vi.fn(async () => {}),
      findById: vi.fn(),
      listByUser: vi.fn(),
      touchUpdatedAt: vi.fn(),
      deleteById: vi.fn(),
    };
    const msgRepo = { insert: vi.fn(), listByConversation: vi.fn() };
    const db = { transaction: vi.fn() };
    const service = new MemoryService(convRepo as any, msgRepo as any, db as any);

    const result = await service.createConversation('user1', { title: 'hello' });

    expect(convRepo.insert).toHaveBeenCalledOnce();
    const arg = (convRepo.insert.mock.calls[0] as unknown[])[0] as { userId: string; title: string; id: string };
    expect(arg.userId).toBe('user1');
    expect(arg.title).toBe('hello');
    expect(arg.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(result.userId).toBe('user1');
    expect(result.title).toBe('hello');
  });

  it('accepts null title', async () => {
    const convRepo = {
      insert: vi.fn(async () => {}),
      findById: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    const result = await service.createConversation('user1', { title: null });
    expect(result.title).toBeNull();
  });
});

describe('MemoryService.getConversation', () => {
  it('returns the conversation when owned by user', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    const r = await service.getConversation('user1', conv.id);
    expect(r.id).toBe(conv.id);
  });

  it('throws ConversationNotFoundError when id unknown', async () => {
    const convRepo = {
      findById: vi.fn(async () => null),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.getConversation('user1', 'missing')).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it('throws ConversationForbiddenError when owned by another user', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.getConversation('user1', conv.id)).rejects.toBeInstanceOf(ConversationForbiddenError);
  });
});

describe('MemoryService.listConversations', () => {
  it('passes userId + opts through to repository', async () => {
    const convRepo = {
      listByUser: vi.fn(async () => ({ items: [], nextCursor: null })),
      findById: vi.fn(), insert: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    const r = await service.listConversations('user1', { limit: 20, cursor: 'abc' });
    expect(convRepo.listByUser).toHaveBeenCalledWith('user1', { limit: 20, cursor: 'abc' });
    expect(r.items).toEqual([]);
  });
});

describe('MemoryService.deleteConversation', () => {
  it('deletes when owned by user', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      deleteById: vi.fn(async () => {}),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await service.deleteConversation('user1', conv.id);
    expect(convRepo.deleteById).toHaveBeenCalledWith(conv.id);
  });

  it('throws ConversationForbiddenError when owned by another user', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      deleteById: vi.fn(),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.deleteConversation('user1', conv.id)).rejects.toBeInstanceOf(ConversationForbiddenError);
    expect(convRepo.deleteById).not.toHaveBeenCalled();
  });

  it('throws ConversationNotFoundError when id unknown', async () => {
    const convRepo = {
      findById: vi.fn(async () => null),
      deleteById: vi.fn(),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.deleteConversation('user1', 'missing')).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe('MemoryService.addMessage', () => {
  it('inserts message + touches conversation inside a transaction', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      touchUpdatedAt: vi.fn(async () => {}),
      insert: vi.fn(), listByUser: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = {
      insert: vi.fn(async () => {}),
      listByConversation: vi.fn(),
    };
    // Fake a Kysely-like db with a transaction() helper
    const executor = { __tx: true };
    const db = {
      transaction: () => ({ execute: async (fn: (tx: any) => any) => fn(executor) }),
    };
    const service = new MemoryService(convRepo as any, msgRepo as any, db as any);

    const msg = await service.addMessage('user1', conv.id, { role: 'user', content: 'hi' });

    expect(msgRepo.insert).toHaveBeenCalledOnce();
    expect(convRepo.touchUpdatedAt).toHaveBeenCalledOnce();
    // Both calls received the tx executor
    const calls0 = msgRepo.insert.mock.calls[0] as unknown[];
    const calls1 = convRepo.touchUpdatedAt.mock.calls[0] as unknown[];
    expect(calls0[1]).toBe(executor);
    expect(calls1[2]).toBe(executor);
    expect(msg.conversationId).toBe(conv.id);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hi');
    expect(msg.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('throws ConversationForbiddenError before touching db when not owner', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      touchUpdatedAt: vi.fn(),
      insert: vi.fn(), listByUser: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = { insert: vi.fn(), listByConversation: vi.fn() };
    const db = { transaction: vi.fn() };
    const service = new MemoryService(convRepo as any, msgRepo as any, db as any);

    await expect(
      service.addMessage('user1', conv.id, { role: 'user', content: 'x' }),
    ).rejects.toBeInstanceOf(ConversationForbiddenError);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(msgRepo.insert).not.toHaveBeenCalled();
  });
});

describe('MemoryService.listMessages', () => {
  it('enforces ownership then delegates to repo', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = {
      listByConversation: vi.fn(async () => ({ items: [], nextCursor: null })),
      insert: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, msgRepo as any, {} as any);

    const r = await service.listMessages('user1', conv.id, { limit: 50 });
    expect(msgRepo.listByConversation).toHaveBeenCalledWith(conv.id, { limit: 50 });
    expect(r.items).toEqual([]);
  });

  it('refuses when caller is not owner', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = { listByConversation: vi.fn(), insert: vi.fn() };
    const service = new MemoryService(convRepo as any, msgRepo as any, {} as any);

    await expect(
      service.listMessages('user1', conv.id, { limit: 50 }),
    ).rejects.toBeInstanceOf(ConversationForbiddenError);
    expect(msgRepo.listByConversation).not.toHaveBeenCalled();
  });
});
