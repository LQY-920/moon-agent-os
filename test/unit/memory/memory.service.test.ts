import { describe, it, expect, vi } from 'vitest';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationNotFoundError, ConversationForbiddenError } from '../../../src/modules/memory/domain/errors';
import type { Conversation } from '../../../src/modules/memory/domain/conversation';
import type { Message } from '../../../src/modules/memory/domain/message';

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
    const arg = convRepo.insert.mock.calls[0][0];
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
