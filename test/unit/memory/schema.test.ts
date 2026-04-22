import { describe, it, expect } from 'vitest';
import {
  CreateConversationInput,
  AddMessageInput,
  ListConversationsQuery,
  ListMessagesQuery,
  ConversationIdParam,
} from '../../../src/modules/memory/schema';

describe('CreateConversationInput', () => {
  it('accepts empty body', () => {
    const r = CreateConversationInput.parse({});
    expect(r).toEqual({});
  });

  it('accepts title with 1-200 chars', () => {
    const r = CreateConversationInput.parse({ title: 'hello' });
    expect(r.title).toBe('hello');
  });

  it('rejects title longer than 200', () => {
    expect(() => CreateConversationInput.parse({ title: 'a'.repeat(201) })).toThrow();
  });

  it('coerces empty-string title to null', () => {
    const r = CreateConversationInput.parse({ title: '' });
    expect(r.title).toBeNull();
  });
});

describe('AddMessageInput', () => {
  it('accepts valid role + content', () => {
    expect(AddMessageInput.parse({ role: 'user', content: 'hi' })).toEqual({ role: 'user', content: 'hi' });
    expect(AddMessageInput.parse({ role: 'ai', content: 'hi' }).role).toBe('ai');
    expect(AddMessageInput.parse({ role: 'system', content: 'hi' }).role).toBe('system');
  });

  it('rejects invalid role', () => {
    expect(() => AddMessageInput.parse({ role: 'bot', content: 'x' })).toThrow();
  });

  it('rejects empty content', () => {
    expect(() => AddMessageInput.parse({ role: 'user', content: '' })).toThrow();
  });

  it('rejects content longer than 65535', () => {
    expect(() => AddMessageInput.parse({ role: 'user', content: 'a'.repeat(65536) })).toThrow();
  });
});

describe('ListConversationsQuery', () => {
  it('applies defaults when empty', () => {
    const r = ListConversationsQuery.parse({});
    expect(r.limit).toBe(20);
    expect(r.cursor).toBeUndefined();
  });

  it('coerces limit from string (query param)', () => {
    const r = ListConversationsQuery.parse({ limit: '50' });
    expect(r.limit).toBe(50);
  });

  it('clamps limit to max 100', () => {
    expect(() => ListConversationsQuery.parse({ limit: '101' })).toThrow();
  });
});

describe('ListMessagesQuery', () => {
  it('default limit is 50', () => {
    expect(ListMessagesQuery.parse({}).limit).toBe(50);
  });

  it('clamps limit to max 200', () => {
    expect(() => ListMessagesQuery.parse({ limit: '201' })).toThrow();
  });
});

describe('ConversationIdParam', () => {
  it('accepts 26-char ULID-ish string', () => {
    const r = ConversationIdParam.parse({ id: '01K40A8Y3V9E2XBSG5HMTVKQ11' });
    expect(r.id.length).toBe(26);
  });

  it('rejects wrong length', () => {
    expect(() => ConversationIdParam.parse({ id: 'abc' })).toThrow();
  });
});