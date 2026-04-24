import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      content: [{ text: 'hello from llm' }],
    })));
    vi.stubGlobal('fetch', mockFetch);

    const messages: LlmMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
    ];
    const result = await client.complete(messages);

    expect(result.content).toBe('hello from llm');
    expect(mockFetch).toHaveBeenCalledOnce();
    // Verify Anthropic headers
    const [, options] = mockFetch.mock.calls[0];
    const headers = (options as any).headers;
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');

    vi.stubGlobal('fetch', undefined);
  });
});