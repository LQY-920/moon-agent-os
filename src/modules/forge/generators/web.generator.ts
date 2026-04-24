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
  // 尝试提取 JSON（支持 markdown 代码块格式）
  let jsonStr = content.trim();

  // 移除 markdown 代码块标记
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 尝试多种解析策略
  const strategies = [
    // 策略1: 直接解析
    () => JSON.parse(jsonStr),
    // 策略2: 提取第一个 JSON 对象
    () => {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('无法从响应中提取 JSON');
      return JSON.parse(match[0]);
    },
    // 策略3: 提取 entryHtml 值（更宽松的解析）
    () => {
      const entryMatch = jsonStr.match(/"entryHtml"\s*:\s*"([\s\S]*?)"(?=,|\s*\}|\s*$)/m);
      if (!entryMatch) throw new Error('无法提取 entryHtml');
      // 尝试从完整的 JSON 中提取
      const fullMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (fullMatch) {
        return JSON.parse(fullMatch[0]);
      }
      throw new Error('无法解析完整 JSON');
    },
  ];

  for (const strategy of strategies) {
    try {
      const parsed = strategy();
      if (parsed && parsed.entryHtml && typeof parsed.entryHtml === 'string') {
        return { entryHtml: parsed.entryHtml, assets: parsed.assets ?? {} };
      }
    } catch {
      // 继续尝试下一个策略
    }
  }

  throw new Error('无法从响应中提取有效的 JSON');
}
