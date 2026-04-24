export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface LlmResponse {
  content: string;
}

export interface LlmClient {
  complete(messages: LlmMessage[]): Promise<LlmResponse>;
}
