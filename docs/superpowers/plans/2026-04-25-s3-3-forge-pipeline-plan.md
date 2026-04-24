# S3.3 · 生成流水线(Forge Pipeline)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 S3.3 Forge Pipeline，将 S3.1 捕获的意图通过 LLM 直译生成网页产物，存入 S3.2 artifact 表，并写消息到 S2.1 记忆。

**Architecture:** LLM 直译策略。ForgeService 接收 description，调用 LlmClient 生成代码，解析 JSON 响应后存入 artifact，最后写回记忆。复用 S3.1 的 LlmClient。

**Tech Stack:** TypeScript · Express · Kysely · MySQL · Native LLM Client (OpenAI-compatible API)

---

## 文件结构

```
src/
├── config/
│   └── forge-prompt.ts              # 新增：prompt 配置
├── modules/forge/
│   ├── domain/
│   │   └── errors.ts                # 新增：ForgeGenerationError
│   ├── generators/
│   │   └── web.generator.ts         # 新增：web 生成器
│   └── services/
│       └── forge.service.ts         # 新增：从 stub 升级
└── main.ts                          # 修改：更新 ForgeService 装配

test/
├── unit/forge/
│   ├── web.generator.test.ts       # 新增
│   └── forge.service.test.ts       # 新增
└── integration/forge/
    └── forge.service.int.test.ts   # 新增
```

---

## Task 1: 创建 prompt 配置

**Files:**
- Create: `src/config/forge-prompt.ts`
- Reference: `src/config/intent-prompt.ts`

- [ ] **Step 1: 创建 forge-prompt.ts**

```typescript
// src/config/forge-prompt.ts

export const FORGE_WEB_SYSTEM_PROMPT = `你是一个前端代码生成器。生成一个响应式单页应用。

要求：
1. 使用语义化 HTML5 标签
2. 响应式布局（适配桌面和移动）
3. 基本交互功能（按钮、表单等）
4. 代码完整，可直接在浏览器运行

输出格式（必须是有效的 JSON）：
{
  "entryHtml": "完整的 HTML（含内联 CSS 和 JS）",
  "assets": {}
}`;
```

- [ ] **Step 2: Commit**

```bash
git add src/config/forge-prompt.ts
git commit -m "feat(s3.3): add forge web prompt configuration"
```

---

## Task 2: 创建 domain 错误类

**Files:**
- Create: `src/modules/forge/domain/errors.ts`
- Reference: `src/modules/artifact/domain/errors.ts`

- [ ] **Step 1: 创建 ForgeGenerationError**

```typescript
// src/modules/forge/domain/errors.ts

import { AppError } from '../../../core/errors';

export class ForgeGenerationError extends AppError {
  readonly code = 'FORGE_GENERATION_ERROR';
  readonly status = 500;
  constructor(message: string) { super(message); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/domain/errors.ts
git commit -m "feat(s3.3): add ForgeGenerationError"
```

---

## Task 3: 创建 web 生成器

**Files:**
- Create: `src/modules/forge/generators/web.generator.ts`
- Create: `test/unit/forge/web.generator.test.ts`
- Reference: `src/modules/llm/client.ts`

- [ ] **Step 1: 创建 web.generator.ts**

```typescript
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
```

- [ ] **Step 2: 创建单元测试**

```typescript
// test/unit/forge/web.generator.test.ts

import { describe, it, expect } from 'vitest';
import { buildWebPrompt, parseWebResponse } from '../../../src/modules/forge/generators/web.generator';
import { FORGE_WEB_SYSTEM_PROMPT } from '../../../src/config/forge-prompt';

describe('buildWebPrompt', () => {
  it('returns system + user messages', () => {
    const msgs = buildWebPrompt('我要一个记账 app');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('system message contains FORGE_WEB_SYSTEM_PROMPT', () => {
    const msgs = buildWebPrompt('test');
    expect(msgs[0].content).toBe(FORGE_WEB_SYSTEM_PROMPT);
  });

  it('user message contains description', () => {
    const desc = '我要一个记账 app';
    const msgs = buildWebPrompt(desc);
    expect(msgs[1].content).toBe(desc);
  });
});

describe('parseWebResponse', () => {
  it('parses valid JSON with entryHtml', () => {
    const content = JSON.stringify({
      entryHtml: '<html><body>Hello</body></html>',
      assets: { style: 'body { color: red; }' },
    });
    const result = parseWebResponse(content);
    expect(result.entryHtml).toBe('<html><body>Hello</body></html>');
    expect(result.assets).toEqual({ style: 'body { color: red; }' });
  });

  it('handles extra text before JSON', () => {
    const content = '好的，这是生成的代码：\n' + JSON.stringify({
      entryHtml: '<html>test</html>',
      assets: {},
    });
    const result = parseWebResponse(content);
    expect(result.entryHtml).toBe('<html>test</html>');
  });

  it('throws when no JSON found', () => {
    expect(() => parseWebResponse('这不是 JSON')).toThrow('无法从响应中提取 JSON');
  });

  it('throws when entryHtml missing', () => {
    const content = JSON.stringify({ assets: {} });
    expect(() => parseWebResponse(content)).toThrow('响应缺少 entryHtml 字段');
  });

  it('throws when JSON invalid', () => {
    expect(() => parseWebResponse('{ invalid json }')).toThrow('JSON 解析失败');
  });

  it('defaults assets to empty object if missing', () => {
    const content = JSON.stringify({ entryHtml: '<html>test</html>' });
    const result = parseWebResponse(content);
    expect(result.assets).toEqual({});
  });
});
```

- [ ] **Step 3: Run unit tests**

Run: `pnpm test:unit test/unit/forge/web.generator.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/modules/forge/generators/web.generator.ts test/unit/forge/web.generator.test.ts
git commit -m "feat(s3.3): add web generator (prompt + response parsing)"
```

---

## Task 4: 升级 ForgeService 从 stub 到真实实现

**Files:**
- Create: `src/modules/forge/services/forge.service.ts`
- Delete: `src/modules/forge/forge.service.ts`
- Modify: `src/main.ts` (更新装配)
- Create: `test/unit/forge/forge.service.test.ts`
- Reference: `src/modules/artifact/services/artifact.service.ts`

- [ ] **Step 1: 创建 services/forge.service.ts**

```typescript
// src/modules/forge/services/forge.service.ts

import type { LlmClient } from '../../llm/client';
import type { ArtifactService } from '../../artifact/services/artifact.service';
import type { MemoryService } from '../../memory/services/memory.service';
import { buildWebPrompt, parseWebResponse } from '../generators/web.generator';
import { ForgeGenerationError } from '../domain/errors';

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
  ): Promise<void> {
    const { description } = input;

    // 1. 调用 LLM 生成代码
    const response = await this.llm.complete(buildWebPrompt(description));

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
          generatedBy: 'forge-m2',
          generatedAt: new Date().toISOString(),
        },
      },
      origin: 'user_intent',
    });

    // 4. 写回记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: `产物已生成：${artifact.title}，ID: ${artifact.id}`,
    });
  }
}
```

- [ ] **Step 2: 删除旧的 stub 文件**

Run: `rm src/modules/forge/forge.service.ts`

- [ ] **Step 3: 修改 main.ts 装配**

在 `buildApp()` 函数中，找到第 76 行：
```typescript
// 原来：
const forgeService = new ForgeService();

// 改为：
const forgeService = new ForgeService(llmClient, artifactService, memoryService);
```

同时删除第 72 行的 `void artifactService;` 行（不再需要）。

- [ ] **Step 4: 创建单元测试**

```typescript
// test/unit/forge/forge.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgeService } from '../../../src/modules/forge/services/forge.service';
import type { LlmClient } from '../../../src/modules/llm/client';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import type { MemoryService } from '../../../src/modules/memory/services/memory.service';

describe('ForgeService', () => {
  let forge: ForgeService;
  let mockLlm: LlmClient;
  let mockArtifact: ArtifactService;
  let mockMemory: MemoryService;

  beforeEach(() => {
    mockLlm = { complete: vi.fn() };
    mockArtifact = {
      create: vi.fn().mockResolvedValue({
        id: 'artifact-123',
        title: 'Web App: 测试应用',
      }),
    } as unknown as ArtifactService;
    mockMemory = {
      addMessage: vi.fn().mockResolvedValue({}),
    } as unknown as MemoryService;
    forge = new ForgeService(mockLlm, mockArtifact, mockMemory);
  });

  it('calls LLM with web prompt', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: '一个测试应用',
      form: 'web',
    });

    expect(mockLlm.complete).toHaveBeenCalled();
    const callArgs = (mockLlm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs[0].role).toBe('system');
    expect(callArgs[1].role).toBe('user');
    expect(callArgs[1].content).toBe('一个测试应用');
  });

  it('creates artifact with correct input', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: '一个记账 app',
      form: 'web',
    });

    expect(mockArtifact.create).toHaveBeenCalledWith('user1', {
      kind: 'web',
      title: 'Web App: 一个记账 app',
      payload: expect.objectContaining({
        entryHtml: '<html>test</html>',
        assets: {},
        metadata: expect.objectContaining({
          generatedBy: 'forge-m2',
        }),
      }),
      origin: 'user_intent',
    });
  });

  it('writes completion message to memory', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: '测试',
      form: 'web',
    });

    expect(mockMemory.addMessage).toHaveBeenCalledWith(
      'user1',
      'session1',
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('产物已生成'),
      }),
    );
  });

  it('truncates title at 50 chars', async () => {
    const longDesc = '这是一个非常非常非常非常非常非常非常非常非常非常长的描述';
    mockLlm.complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ entryHtml: '<html>test</html>', assets: {} }),
    });

    await forge.triggerFromIntent('user1', 'session1', {
      description: longDesc,
      form: 'web',
    });

    expect(mockArtifact.create).toHaveBeenCalledWith('user1', expect.objectContaining({
      title: `Web App: ${longDesc.substring(0, 50)}`,
    }));
  });

  it('throws ForgeGenerationError on invalid LLM response', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({ content: 'not json' });

    await expect(
      forge.triggerFromIntent('user1', 'session1', {
        description: 'test',
        form: 'web',
      }),
    ).rejects.toThrow('LLM 响应格式错误');
  });

  it('does not create artifact when LLM response invalid', async () => {
    mockLlm.complete = vi.fn().mockResolvedValue({ content: 'invalid' });

    try {
      await forge.triggerFromIntent('user1', 'session1', {
        description: 'test',
        form: 'web',
      });
    } catch { /* ignore */ }

    expect(mockArtifact.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run unit tests**

Run: `pnpm test:unit test/unit/forge/forge.service.test.ts`
Expected: All tests pass

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/modules/forge/services/forge.service.ts src/main.ts test/unit/forge/forge.service.test.ts
git rm src/modules/forge/forge.service.ts
git commit -m "feat(s3.3): implement ForgeService (LLM → artifact → memory)"
```

---

## Task 5: 创建集成测试

**Files:**
- Create: `test/integration/forge/forge.service.int.test.ts`
- Reference: `test/integration/artifact/artifact.repository.int.test.ts`, `test/integration/setup.ts`

- [ ] **Step 1: 创建集成测试**

```typescript
// test/integration/forge/forge.service.int.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { InMemoryArtifactSchemaRegistry } from '../../../src/modules/artifact/registry';
import { WebArtifactPayload } from '../../../src/modules/artifact/registry/web.schema';
import { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { MessageRepository } from '../../../src/modules/memory/repositories/message.repository';
import { ForgeService } from '../../../src/modules/forge/services/forge.service';
import type { LlmClient } from '../../../src/modules/llm/client';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let forge: ForgeService;
let artifactService: ArtifactService;
let memoryService: MemoryService;
let cleanup: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;

  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `forge-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Forge Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();

  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  memoryService = new MemoryService(conversationRepo, messageRepo, db);

  const registry = new InMemoryArtifactSchemaRegistry();
  registry.register('web', WebArtifactPayload);
  const artifactRepo = new ArtifactRepository(db);
  artifactService = new ArtifactService(artifactRepo, registry);

  const mockLlm: LlmClient = {
    complete: async () => ({
      content: JSON.stringify({
        entryHtml: '<html><body><h1>测试应用</h1><p>这是一个测试页面</p></body></html>',
        assets: {},
      }),
    }),
  };

  forge = new ForgeService(mockLlm, artifactService, memoryService);
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('artifacts').where('user_id', 'eq', userId).execute();
  await db.deleteFrom('messages').where('conversation_id', 'in',
    db.selectFrom('conversations').select('id').where('user_id', 'eq', userId)
  ).execute();
  await db.deleteFrom('conversations').where('user_id', 'eq', userId).execute();
  await db.deleteFrom('users').where('id', 'eq', userId).execute();
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('artifacts').where('user_id', 'eq', userId).execute();
  await db.deleteFrom('messages').execute();
  await db.deleteFrom('conversations').where('user_id', 'eq', userId).execute();
});

describe('ForgeService integration', () => {
  it('complete flow: generate → artifact → memory', async () => {
    // 1. 创建会话
    const conv = await memoryService.createConversation(userId, { title: 'forge-test' });

    // 2. 触发生成
    await forge.triggerFromIntent(userId, conv.id, {
      description: '一个测试应用',
      form: 'web',
    });

    // 3. 验证 artifact 已创建
    const artifacts = await artifactService.listByUser(userId, { limit: 10 });
    expect(artifacts.items.length).toBeGreaterThan(0);
    const artifact = artifacts.items[0];
    expect(artifact.kind).toBe('web');
    expect(artifact.origin).toBe('user_intent');
    expect(artifact.title).toBe('Web App: 一个测试应用');

    // 4. 验证记忆已写入
    const messages = await memoryService.listMessages(userId, conv.id, { limit: 10 });
    const lastMessage = messages.items[messages.items.length - 1];
    expect(lastMessage.role).toBe('system');
    expect(lastMessage.content).toContain('产物已生成');
    expect(lastMessage.content).toContain(artifact.id);
  });

  it('title truncates at 50 characters', async () => {
    const conv = await memoryService.createConversation(userId, { title: 'truncate-test' });
    const longDesc = '这是一个非常非常非常非常非常非常非常非常非常非常长的描述，超过50字符';

    await forge.triggerFromIntent(userId, conv.id, {
      description: longDesc,
      form: 'web',
    });

    const artifacts = await artifactService.listByUser(userId, { limit: 10 });
    const latest = artifacts.items.find(a => a.title.includes('Web App:'));
    expect(latest!.title).toHaveLength(`Web App: ${longDesc.substring(0, 50)}`.length);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `pnpm test:integration test/integration/forge/forge.service.int.test.ts`
Expected: All tests pass (requires Docker Desktop running)

- [ ] **Step 3: Commit**

```bash
git add test/integration/forge/forge.service.int.test.ts
git commit -m "test(s3.3): add forge service integration tests"
```

---

## Task 6: 全量验证

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Update README if needed**

检查 README.md 是否需要更新 S3.3 完成状态（参考 S3.1 完成后更新方式）

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(s3.3): mark complete in README"
```

---

## 依赖关系

```
Task 1 (forge-prompt.ts)
    ↓
Task 2 (errors.ts) ──────────────────────────┐
    ↓                                      ↓
Task 3 (web.generator.ts) ←── (依赖 Task 1)  │
    ↓                                      │
Task 4 (forge.service.ts) ←── (依赖 Task 2, 3)
    ↓
Task 5 (integration tests)
    ↓
Task 6 (full verification)
```

---

*实现计划基于 2026-04-25 设计文档。*
