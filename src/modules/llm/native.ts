import type { LlmClient, LlmMessage, LlmResponse } from './client';

export class NativeLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://api.anthropic.com/v1',
  ) {}

  async complete(messages: LlmMessage[]): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { content: Array<{ text: string }> };
    return { content: data.content[0]?.text ?? '' };
  }
}