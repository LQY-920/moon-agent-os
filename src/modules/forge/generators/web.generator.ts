// src/modules/forge/generators/web.generator.ts

import type { LlmMessage } from '../../llm/client';
import { FORGE_WEB_SYSTEM_PROMPT } from '../../../config/forge-prompt';

export function buildWebPrompt(description: string): LlmMessage[] {
  return [
    { role: 'system', content: FORGE_WEB_SYSTEM_PROMPT },
    { role: 'user', content: description },
  ];
}

export function parseWebResponse(content: string): {
  entryHtml: string;
  assets: Record<string, string>;
} {
  // 提取 JSON 对象（兼容 LLM 输出中可能有额外文字）
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('无法从响应中提取 JSON');
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.entryHtml || typeof parsed.entryHtml !== 'string') {
      throw new Error('响应缺少 entryHtml 字段');
    }
    return {
      entryHtml: parsed.entryHtml,
      assets: parsed.assets ?? {},
    };
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}
