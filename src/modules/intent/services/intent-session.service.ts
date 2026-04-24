import type { LlmMessage } from '../../llm/client';
import type { Message } from '../../memory/domain/message';
import type { Conversation } from '../../memory/domain/conversation';
import type { MemoryService } from '../../memory/services/memory.service';
import type { LlmClient } from '../../llm/client';
import type { ForgeService } from '../../forge/services/forge.service';
import { INTENT_SYSTEM_PROMPT } from '../../../config/intent-prompt';

export type IntentStatus = 'clarifying' | 'triggered';
export type IntentSummary = { description: string; form: 'web' };

export type SendMessageResult = {
  message: string;
  status: IntentStatus;
  intent: IntentSummary | null;
};

export class IntentSessionService {
  constructor(
    private readonly memory: MemoryService,
    private readonly llm: LlmClient,
    private readonly forge: ForgeService,
  ) {}

  async createSession(userId: string): Promise<Conversation> {
    return this.memory.createConversation(userId, {
      title: `intent:${Date.now()}`,
    });
  }

  async sendMessage(
    userId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<SendMessageResult> {
    // 归属校验(如果不存在/不属于本人,MemoryService 会抛错)
    await this.memory.getConversation(userId, sessionId);

    // 写用户消息入记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'user',
      content: userMessage,
    });

    // 读对话历史
    const historyResult = await this.memory.listMessages(userId, sessionId, { limit: 100 });
    const llmMessages = buildLlmMessages(historyResult.items, INTENT_SYSTEM_PROMPT);

    // LLM 调用
    const response = await this.llm.complete(llmMessages);

    // 解析
    const { isExecutable, responseText, intentDescription } = parseLlmOutput(response.content);

    // 写 AI 回复入记忆(role=system 标记为 AI 追问)
    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: responseText,
    });

    // 判断
    if (isExecutable) {
      await this.forge.triggerFromIntent(userId, sessionId, {
        description: intentDescription ?? userMessage,
        form: 'web',
      });
      return {
        message: responseText,
        status: 'triggered',
        intent: { description: intentDescription ?? userMessage, form: 'web' },
      };
    }
    return { message: responseText, status: 'clarifying', intent: null };
  }
}

// --- helpers ---

export function buildLlmMessages(
  history: Message[],
  systemPrompt: string,
): LlmMessage[] {
  const msgs: LlmMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'system') msgs.push({ role: 'assistant', content: m.content });
    // 'ai' role 不出现在 S3.1 对话里,跳过
  }
  return msgs;
}

export function parseLlmOutput(content: string): {
  isExecutable: boolean;
  responseText: string;
  intentDescription: string | null;
} {
  if (content.includes('__EXECUTE__')) {
    const descMatch = content.match(/"description":\s*"([^"]+)"/);
    return {
      isExecutable: true,
      responseText: content.replace(/__EXECUTE__[\s\S]*$/, '').trim(),
      intentDescription: descMatch ? descMatch[1] : null,
    };
  }
  return {
    isExecutable: false,
    responseText: content.trim(),
    intentDescription: null,
  };
}
