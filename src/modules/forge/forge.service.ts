export type ForgeInput = { description: string; form: 'web' };

export class ForgeService {
  async triggerFromIntent(
    userId: string,
    sessionId: string,
    input: ForgeInput,
  ): Promise<void> {
    // M3 实现:
    // 1. 从 description 提取结构化信息
    // 2. 调 LLM 生成代码
    // 3. 生成 artifact (kind='web', payload = { entryHtml, metadata })
    // 4. artifactService.create(userId, { kind: 'web', payload, origin: 'user_intent' })
    console.log(`[forge stub] user=${userId} session=${sessionId} form=${input.form} desc=${input.description}`);
  }
}