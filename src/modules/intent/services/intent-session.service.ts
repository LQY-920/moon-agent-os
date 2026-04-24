// src/modules/intent/services/intent-session.service.ts

import type { LlmMessage } from '../../llm/client';
import type { Message } from '../../memory/domain/message';
import type { Conversation } from '../../memory/domain/conversation';
import type { MemoryService } from '../../memory/services/memory.service';
import type { LlmClient } from '../../llm/client';
import type { ForgeService } from '../../forge/services/forge.service';
import type { FeedbackService } from '../../feedback/services/feedback.service';
import { INTENT_SYSTEM_PROMPT } from '../../../config/intent-prompt';

export type IntentStatus = 'clarifying' | 'triggered';
export type IntentSummary = { description: string; form: 'web' };

export type SendMessageResult = {
  message: string;
  status: IntentStatus;
  intent: IntentSummary | null;
};

// 迭代关键词（Q10）：用于检测用户迭代意图
export const ITERATE_KEYWORDS = [
  '改进', '重新生成', '再来一次', '再试一次',
  '改一下', '重新做一个', '重新来', '再做一个',
  'improve', 'retry', 'regenerate', 'again',
] as const;

export function detectIterateMode(message: string): boolean {
  return ITERATE_KEYWORDS.some(kw => message.toLowerCase().includes(kw.toLowerCase()));
}

export class IntentSessionService {
  constructor(
    private readonly memory: MemoryService,
    private readonly llm: LlmClient,
    private readonly forge: ForgeService,
    private readonly feedbackService: FeedbackService,  // 新增第四参数
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
    // 归属校验
    await this.memory.getConversation(userId, sessionId);

    // 写用户消息入记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'user',
      content: userMessage,
    });

    // 读对话历史
    const historyResult = await this.memory.listMessages(userId, sessionId, { limit: 100 });
    const llmMessages = buildLlmMessages(historyResult.items, INTENT_SYSTEM_PROMPT);

    // 调用 LLM（意图捕获阶段不注入反馈）
    const response = await this.llm.complete(llmMessages);

    // 解析
    const { isExecutable, responseText, intentDescription } = parseLlmOutput(response.content);

    // 写 AI 回复入记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: responseText,
    });

    if (isExecutable) {
      const description = intentDescription ?? userMessage;

      // 迭代模式检测（Q10）：在用户原始消息上判断
      const isIterate = detectIterateMode(userMessage);

      let feedbackContext = '';
      let parentArtifactId: string | null = null;
      if (isIterate) {
        // 查询历史反馈（Q7/Q8：上限 5 条）
        const feedbacks = await this.feedbackService.matchByIntent(userId, description, 5);
        feedbackContext = this.feedbackService.injectIntoPrompt(feedbacks);
        // parent = matchByIntent 结果中最新的那个（Q15）
        parentArtifactId = feedbacks[0]?.artifactId ?? null;
      }

      // 透传 ForgeIterationContext
      await this.forge.triggerFromIntent(userId, sessionId, {
        description,
        form: 'web',
      }, feedbackContext ? { feedbackContext, parentArtifactId } : undefined);

      return {
        message: responseText,
        status: 'triggered',
        intent: { description, form: 'web' },
      };
    }
    return { message: responseText, status: 'clarifying', intent: null };
  }
}

// --- helpers（保持不变）---

export function buildLlmMessages(
  history: Message[],
  systemPrompt: string,
): LlmMessage[] {
  const msgs: LlmMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'system') msgs.push({ role: 'assistant', content: m.content });
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