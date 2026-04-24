import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeLlmClient } from '../../../src/modules/llm/native';
import type { LlmMessage } from '../../../src/modules/llm/client';

describe('NativeLlmClient', () => {
  let client: NativeLlmClient;

  beforeEach(() => {
    client = new NativeLlmClient('test-api-key', 'test-model');
  });

  it('constructs with apiKey and model', () => {
    expect(client).toBeDefined();
  });

  it('complete is async and returns LlmResponse', async () => {
    // Mock global fetch
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hello from llm' } }],
    })));
    vi.stubGlobal('fetch', mockFetch);

    const messages: LlmMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
    ];
    const result = await client.complete(messages);

    expect(result.content).toBe('hello from llm');
    expect(mockFetch).toHaveBeenCalledOnce();
    // Verify DeepSeek headers
    const calls = mockFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    const headers = calls[1].headers;
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['Content-Type']).toBe('application/json');

    vi.stubGlobal('fetch', undefined);
  });
});