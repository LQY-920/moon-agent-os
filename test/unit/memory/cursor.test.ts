import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../src/modules/memory/repositories/cursor';

describe('cursor', () => {
  it('round-trips an ISO date + id', () => {
    const t = new Date('2026-04-23T10:15:30.123Z');
    const id = '01K40A8Y3V9E2XBSG5HMTVKQ11';
    const c = encodeCursor({ t, id });
    expect(c).toMatch(/^[A-Za-z0-9+/=_-]+$/);  // base64url-ish
    const back = decodeCursor(c);
    expect(back.id).toBe(id);
    expect(back.t.toISOString()).toBe(t.toISOString());
  });

  it('rejects malformed cursor', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
    expect(() => decodeCursor('eyJicm9rZW4iOnRydWV9')).toThrow();  // valid base64 but wrong shape
  });
});
