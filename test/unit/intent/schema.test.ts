import { describe, it, expect } from 'vitest';
import {
  SendMessageBody,
  ConversationIdParam,
} from '../../../src/modules/intent/schema';

describe('SendMessageBody', () => {
  it('accepts valid message', () => {
    const r = SendMessageBody.parse({ message: 'hello' });
    expect(r.message).toBe('hello');
  });

  it('rejects empty message', () => {
    expect(() => SendMessageBody.parse({ message: '' })).toThrow();
  });

  it('rejects missing message', () => {
    expect(() => SendMessageBody.parse({})).toThrow();
  });

  it('accepts message up to 10000 chars', () => {
    const r = SendMessageBody.parse({ message: 'a'.repeat(10000) });
    expect(r.message.length).toBe(10000);
  });

  it('rejects message longer than 10000', () => {
    expect(() => SendMessageBody.parse({ message: 'a'.repeat(10001) })).toThrow();
  });
});

describe('ConversationIdParam', () => {
  it('accepts 26-char string', () => {
    const r = ConversationIdParam.parse({ id: '01K40A8Y3V9E2XBSG5HMTVKQ11' });
    expect(r.id.length).toBe(26);
  });

  it('rejects wrong length', () => {
    expect(() => ConversationIdParam.parse({ id: 'abc' })).toThrow();
  });
});