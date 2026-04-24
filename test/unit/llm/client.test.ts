import { describe, it, expect, vi } from 'vitest';
import type { LlmClient, LlmMessage, LlmResponse } from '../../../src/modules/llm/client';

// 验证接口存在性 + 导出正确
describe('LlmClient interface', () => {
  it('LlmMessage supports system/user/assistant roles', () => {
    const msgs: LlmMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    expect(msgs.length).toBe(3);
  });

  it('LlmResponse has content field', () => {
    const r: LlmResponse = { content: 'response text' };
    expect(r.content).toBe('response text');
  });

  it('LlmClient.complete is typed as returning Promise<LlmResponse>', () => {
    const mockClient: LlmClient = {
      complete: vi.fn(async () => ({ content: 'mock' })),
    };
    expect(typeof mockClient.complete).toBe('function');
  });
});
