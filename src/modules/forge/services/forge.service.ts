// src/modules/forge/services/forge.service.ts

import type { LlmClient } from '../../llm/client';
import type { ArtifactService } from '../../artifact/services/artifact.service';
import type { MemoryService } from '../../memory/services/memory.service';
import type { ArtifactOrigin } from '../../artifact/domain/artifact';
import { buildWebPrompt, parseWebResponse } from '../generators/web.generator';
import { ForgeGenerationError } from '../domain/errors';

export type ForgeIterationContext = {
  feedbackContext: string;
  parentArtifactId: string | null;
};

export class ForgeService {
  constructor(
    private readonly llm: LlmClient,
    private readonly artifact: ArtifactService,
    private readonly memory: MemoryService,
  ) {}

  async triggerFromIntent(
    userId: string,
    sessionId: string,
    input: { description: string; form: 'web' },
    iteration?: ForgeIterationContext,
  ): Promise<void> {
    const { description } = input;
    const hasFeedback = iteration && iteration.feedbackContext.length > 0;

    // 1. 调用 LLM 生成代码
    const baseMessages = buildWebPrompt(description);
    if (hasFeedback) {
      baseMessages[0] = {
        role: 'system',
        content: iteration!.feedbackContext + baseMessages[0].content,
      };
    }
    const response = await this.llm.complete(baseMessages);

    // 2. 解析响应
    let parsed: { entryHtml: string; assets: Record<string, string> };
    try {
      parsed = parseWebResponse(response.content);
    } catch {
      throw new ForgeGenerationError('LLM 响应格式错误，无法解析为 JSON');
    }

    // 3. 存 artifact
    const title = `Web App: ${description.substring(0, 50)}`;
    const artifact = await this.artifact.create(userId, {
      kind: 'web',
      title,
      payload: {
        entryHtml: parsed.entryHtml,
        assets: parsed.assets ?? {},
        metadata: {
          generatedBy: hasFeedback ? 'forge-m3-iteration' : 'forge-m2',
          generatedAt: new Date().toISOString(),
        },
      },
      origin: (hasFeedback ? 'iteration' : 'user_intent') as ArtifactOrigin,
      parentArtifactId: hasFeedback ? iteration!.parentArtifactId : null,
    });

    // 4. 写回记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: `产物已生成：${artifact.title}，ID: ${artifact.id}`,
    });
  }
}
