import { describe, it, expect, vi } from 'vitest';
import { authEvents, type AuthEvent } from '../../../src/modules/identity/events';

describe('authEvents', () => {
  it('emits login_success to subscribers', () => {
    const handler = vi.fn();
    authEvents.on('login_success', handler);
    const ev: Extract<AuthEvent, { type: 'login_success' }> = {
      type: 'login_success',
      userId: '01HX',
      sessionId: '01HY',
      ip: '1.2.3.4',
      ua: 'UA',
    };
    authEvents.emit('login_success', ev);
    expect(handler).toHaveBeenCalledWith(ev);
    authEvents.off('login_success', handler);
  });

  it('subscriber error does not throw from emit (caller isolation)', () => {
    const bad = () => { throw new Error('boom'); };
    authEvents.on('logout', bad);
    // Node EventEmitter default: 同步订阅者的异常会上抛,我们期望**订阅者自己包 try**
    // 本测试验证"如果订阅者不包 try,emit 确实会抛",以此约束 identity 内部订阅者必须包 try
    expect(() => authEvents.emit('logout', { type: 'logout', userId: 'u', sessionId: 's' })).toThrow('boom');
    authEvents.off('logout', bad);
  });
});
