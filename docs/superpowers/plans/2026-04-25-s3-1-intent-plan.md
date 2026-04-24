# S3.1 Intent Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 S3.1 意图捕获子系统。用户的对话式入口:通过多轮 LLM 追问澄清意图,触发生成(M3 Forge 实现前为 stub)。

**Architecture:** 新增 `src/modules/intent/` + `src/modules/llm/` + `src/modules/forge/` + `src/config/intent-prompt.ts`。完全复用 S1.1 的 `requireSession` / S2.1 的 MemoryService。LLM 调用走接口抽象,原生 fetch 实现,S3.1 和未来 S3.3 共用。

**Tech Stack:** TypeScript / Express 5 / Kysely / MySQL 8 / native fetch / zod / ULID / vitest / supertest。沿用既有依赖,不新增 npm 包。

**Spec:** `docs/superpowers/specs/2026-04-25-s3-1-intent-design.md`

**分支:** `feature/s3-1-intent`(已存在,spec 已 commit `29e13b8`)

---

## 实现前关键上下文(必读)

1. **`requireSession` 签名**:返回 `RequestHandler`;`app.use('/api/intent', buildIntentRoutes({ intentCtrl, requireSession: requireSession(sessions, cfg.session.cookieName) }))` 挂载到 `/api/intent`
2. **认证注入**:`res.locals.auth: AuthCtx = { userId, sessionId }`
3. **MemoryService 接口**:
   - `createConversation(userId, { title? }) → Promise<Conversation>`
   - `getConversation(userId, id) → Conversation` (归属不符抛 `ConversationForbiddenError`)
   - `addMessage(userId, conversationId, { role, content }) → Promise<Message>`
   - `listMessages(userId, conversationId, { limit, cursor? }) → Promise<{ items, nextCursor }>`
4. **S3.1 用 S2.1 conversation 作为会话**:`sessionId === conversationId` 同值,不需要独立会话表
5. **LLM API 调用**:用 native `fetch`,Anthropic Messages API(`2023-06-01` 版本头),不需要 SDK
6. **config 扩展**:需要在 `core/config.ts` 加 `LLM_API_KEY` + `LLM_MODEL` 两个字段
7. **S3.1 不用独立 migration**:完全复用 S2.1 的 conversations/messages 表

---

## 文件结构

**新增**:

```
src/config/
└── intent-prompt.ts                     # System prompt 文本

src/modules/llm/
├── client.ts                            # LlmClient 接口 + LlmMessage 类型
└── native.ts                           # NativeLlmClient 实现

src/modules/forge/
└── forge.service.ts                     # ForgeService stub

src/modules/intent/
├── routes.ts
├── schema.ts
├── controllers/
│   └── intent.controller.ts
├── services/
│   └── intent-session.service.ts
└── domain/
    └── errors.ts                      # IntentMessageEmptyError

test/unit/
├── llm/
│   ├── client.test.ts
│   └── intent-session.service.test.ts
└── intent/
    ├── intent-session.service.test.ts   # parseLlmOutput / buildLlmMessages 逻辑
    └── intent-prompt.test.ts           # prompt 文本验证

test/integration/
├── llm/
│   └── native.int.test.ts             # mock server 测试 LLM 调用
└── intent/
    └── intent-session.service.int.test.ts

test/e2e/
└── intent.e2e.test.ts

docs/qa/
└── s3-1-intent-manual-checklist.md
```

**修改**:

- `src/core/config.ts`:加 `LLM_API_KEY` + `LLM_MODEL`
- `src/main.ts`:装配 LLM Client + ForgeService + IntentSessionService + 挂路由

---

## Task 0 · 分支确认

**Files:** 无

- [ ] **Step 1: `git branch --show-current`**

```bash
git branch --show-current
```

Expected:`feature/s3-1-intent`

如果不在:`git checkout feature/s3-1-intent`

- [ ] **Step 2: 确认 spec 已 commit**

```bash
git log --oneline -3
```

Expected:看到 `29e13b8 docs(s3.1): intent capture design` 最新或接近最新。

---

## Task 1 · Config 扩展

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: 在 `ConfigSchema` 里追加两个字段**

在 `ConfigSchema` 的 `z.object({...})` 末尾、`export type Config` 之前,追加:

```typescript
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
```

- [ ] **Step 2: 在 `Config` 类型里追加**

在 `export type Config = {` 的末尾追加:

```typescript
  llm: {
    apiKey: string;
    model: string;
  };
```

- [ ] **Step 3: 在 `loadConfig()` 的 return 里追加**

```typescript
  llm: {
    apiKey: parsed.LLM_API_KEY,
    model: parsed.LLM_MODEL,
  },
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 5: 更新 `.env.example`**

在文件末尾追加:

```bash
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
```

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts .env.example
git commit -m "feat(s3.1): add LLM config fields (apiKey + model)"
```

---

## Task 2 · LLM Client 接口

**Files:**
- Create: `src/modules/llm/client.ts`
- Test: `test/unit/llm/client.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { LlmClient, LlmMessage, LlmResponse } from '../../../src/modules/llm/client';

// 验证接口存在性 + 导出正确
describe('LlmClient interface', () => {
  it('LlmMessage supports system/user/assistant roles', () => {
    const msgs: LlmMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    expect(msgs.length).toBe(3);
  });

  it('LlmResponse has content field', () => {
    const r: LlmResponse = { content: 'response text' };
    expect(r.content).toBe('response text');
  });

  it('LlmClient.complete is typed as returning Promise<LlmResponse>', () => {
    const mockClient: LlmClient = {
      complete: vi.fn(async () => ({ content: 'mock' })),
    };
    expect(typeof mockClient.complete).toBe('function');
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/llm/client.test.ts
```

Expected:FAIL(文件不存在)。

- [ ] **Step 3: 创建 `src/modules/llm/client.ts`**

```typescript
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
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/llm/client.test.ts
```

Expected:PASS(3 条)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/llm/client.ts test/unit/llm/client.test.ts
git commit -m "feat(s3.1): add LLM client interface (LlmClient + LlmMessage)"
```

---

## Task 3 · System Prompt 配置

**Files:**
- Create: `src/config/intent-prompt.ts`
- Test: `test/unit/intent/intent-prompt.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { INTENT_SYSTEM_PROMPT } from '../../../src/config/intent-prompt';

describe('INTENT_SYSTEM_PROMPT', () => {
  it('contains EXECUTE marker', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('__EXECUTE__');
  });

  it('contains description extraction instruction', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('"description":');
  });

  it('contains rule about not generating code', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('不要生成应用代码');
  });

  it('contains rule about questioning when intent unclear', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('追问');
  });

  it('is a non-empty string', () => {
    expect(typeof INTENT_SYSTEM_PROMPT).toBe('string');
    expect(INTENT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/intent/intent-prompt.test.ts
```

Expected:FAIL(文件不存在)。

- [ ] **Step 3: 创建 `src/config/intent-prompt.ts`**

```typescript
export const INTENT_SYSTEM_PROMPT = `你是一个意图捕获助手。

规则:
1. 用户每发一条消息,你判断当前意图是否足够清晰。
2. "清晰"的判断标准:用户描述了要做什么(应用名称或核心功能)。
3. 如果意图不清晰,提一个追问,不超过20个字。
4. 如果意图清晰,返回 EXECUTE 标记,格式:
   __EXECUTE__
   { "description": "用户的完整需求描述" }
   不要加任何其他内容。

注意:不要生成应用代码,只负责理解和追问。`;
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/intent/intent-prompt.test.ts
```

Expected:PASS(5 条)。

- [ ] **Step 5: Commit**

```bash
git add src/config/intent-prompt.ts test/unit/intent/intent-prompt.test.ts
git commit -m "feat(s3.1): add intent system prompt configuration"
```

---

## Task 4 · Native LLM Client 实现

**Files:**
- Create: `src/modules/llm/native.ts`
- Test: `test/unit/llm/native.test.ts`
- Test: `test/integration/llm/native.int.test.ts`

> 本 Task 不需要真实 API key。测试用 `nock` 或 MSW 拦截 fetch,或直接用 testcontainers 起一个 mock HTTP server。

- [ ] **Step 1: 写失败测试 `test/unit/llm/native.test.ts`**

```typescript
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
    }));
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
    const headers = JSON.parse((options as any).body).headers;
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');

    vi.stubGlobal('fetch', undefined);
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/llm/native.test.ts
```

Expected:FAIL。

- [ ] **Step 3: 创建 `src/modules/llm/native.ts`**

```typescript
import type { LlmClient, LlmMessage, LlmResponse } from './client';

export class NativeLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(messages: LlmMessage[]): Promise<LlmResponse> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
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
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/llm/native.test.ts
```

Expected:PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/llm/native.ts test/unit/llm/native.test.ts
git commit -m "feat(s3.1): add NativeLlmClient (Anthropic API fetch)"
```

---

## Task 5 · ForgeService Stub

**Files:**
- Create: `src/modules/forge/forge.service.ts`

> Stub 只是 log,不抛错,不让 S3.1 流程断掉。

- [ ] **Step 1: 创建文件**

```typescript
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/forge/forge.service.ts
git commit -m "feat(s3.1): add ForgeService stub (M3 implementation placeholder)"
```

---

## Task 6 · Intent Domain Errors

**Files:**
- Create: `src/modules/intent/domain/errors.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { AppError } from '../../../core/errors';

export class IntentMessageEmptyError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor() { super('消息内容不能为空'); }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/intent/domain/errors.ts
git commit -m "feat(s3.1): add intent domain errors (IntentMessageEmptyError)"
```

---

## Task 7 · IntentSessionService · 辅助函数 + TDD

**Files:**
- Create: `src/modules/intent/services/intent-session.service.ts` (存根方法)
- Test: `test/unit/intent/intent-session.service.test.ts`

- [ ] **Step 1: 写 `parseLlmOutput` 失败测试**

```typescript
import { describe, it, expect } from 'vitest';
// 这两个函数在 service 文件里,先导入
import { parseLlmOutput, buildLlmMessages } from '../../../src/modules/intent/services/intent-session.service';

describe('parseLlmOutput', () => {
  it('parses EXECUTE with description', () => {
    const r = parseLlmOutput('好的,开始生成。\n__EXECUTE__\n{ "description": "一个记账 app" }');
    expect(r.isExecutable).toBe(true);
    expect(r.intentDescription).toBe('一个记账 app');
    expect(r.responseText).toBe('好的,开始生成。');
  });

  it('parses EXECUTE without description match', () => {
    const r = parseLlmOutput('好的,开始。\n__EXECUTE__\n{ "desc": "no" }');
    expect(r.isExecutable).toBe(true);
    expect(r.intentDescription).toBeNull();
    expect(r.responseText).toBe('好的,开始。');
  });

  it('returns clarifying when no EXECUTE', () => {
    const r = parseLlmOutput('请问你希望记账频率是每天还是每周?');
    expect(r.isExecutable).toBe(false);
    expect(r.responseText).toBe('请问你希望记账频率是每天还是每周?');
    expect(r.intentDescription).toBeNull();
  });

  it('trims whitespace from responseText', () => {
    const r = parseLlmOutput('  追问内容  ');
    expect(r.responseText).toBe('追问内容');
  });
});
```

- [ ] **Step 2: 写 `buildLlmMessages` 失败测试**

```typescript
import type { Message } from '../../../src/modules/memory/domain/message';
import { buildLlmMessages } from '../../../src/modules/intent/services/intent-session.service';

function makeMsg(role: Message['role'], content: string, createdAt = new Date()): Message {
  return { id: '01', conversationId: 'c1', role, content, createdAt };
}

describe('buildLlmMessages', () => {
  it('starts with system message from prompt', () => {
    const msgs = buildLlmMessages([], 'hello', 'SYSTEM PROMPT');
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYSTEM PROMPT' });
  });

  it('maps user role to user', () => {
    const history = [makeMsg('user', '我要记账')];
    const msgs = buildLlmMessages(history, '再问一下', 'sys');
    expect(msgs[1]).toEqual({ role: 'user', content: '我要记账' });
    expect(msgs[2]).toEqual({ role: 'user', content: '再问一下' });
  });

  it('maps system role to assistant (AI reply)', () => {
    const history = [makeMsg('system', '请问频率?')];
    const msgs = buildLlmMessages(history, '用户回复', 'sys');
    expect(msgs[1]).toEqual({ role: 'assistant', content: '请问频率?' });
  });

  it('skips ai role', () => {
    const history = [makeMsg('ai', 'ignored')];
    const msgs = buildLlmMessages(history, 'u', 'sys');
    expect(msgs.find(m => m.content === 'ignored')).toBeUndefined();
  });

  it('last message is always the current user message', () => {
    const msgs = buildLlmMessages([makeMsg('user', 'hi')], 'current', 'sys');
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'current' });
  });
});
```

- [ ] **Step 3: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/intent/intent-session.service.test.ts
```

Expected:FAIL(文件/函数不存在)。

- [ ] **Step 4: 创建 `src/modules/intent/services/intent-session.service.ts`**

```typescript
import type { LlmMessage } from '../../llm/client';
import type { Message } from '../../memory/domain/message';
import type { Conversation } from '../../memory/domain/conversation';
import type { MemoryService } from '../../memory/services/memory.service';
import type { LlmClient, LlmResponse } from '../../llm/client';
import type { ForgeService } from '../../forge/forge.service';
import { ConversationNotFoundError, ConversationForbiddenError } from '../../memory/domain/errors';
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
```

- [ ] **Step 5: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/intent/intent-session.service.test.ts
```

Expected:PASS(10 条)。

- [ ] **Step 6: Commit**

```bash
git add src/modules/intent/services/intent-session.service.ts test/unit/intent/intent-session.service.test.ts
git commit -m "feat(s3.1): add IntentSessionService (buildLlmMessages + parseLlmOutput + core flow)"
```

---

## Task 8 · IntentSessionService · Service 层完整逻辑

**Files:**
- Modify: `src/modules/intent/services/intent-session.service.ts`

Task 7 里 service 只有存根和辅助函数,现在补全 Task 8 把 `IntentSessionService` 完整化 —— Task 7 已经写完了,Task 8 做什么?

**实际上 Task 7 已经交付了完整 service**,不需要 Task 8。但如果后续发现 Service 需要扩展(比如加 `listSessions` 方法),在这里补。

**跳到 Task 9。**

---

## Task 9 · Intent Schema

**Files:**
- Create: `src/modules/intent/schema.ts`
- Test: `test/unit/intent/schema.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import {
  SendMessageBody,
  ConversationIdParam,
} from '../../../src/modules/intent/schema';

describe('SendMessageBody', () => {
  it('accepts valid message', () => {
    const r = SendMessageBody.parse({ message: 'hello' });
    expect(r.message).toBe('hello');
  });

  it('rejects empty message', () => {
    expect(() => SendMessageBody.parse({ message: '' })).toThrow();
  });

  it('rejects missing message', () => {
    expect(() => SendMessageBody.parse({})).toThrow();
  });

  it('accepts message up to 10000 chars', () => {
    const r = SendMessageBody.parse({ message: 'a'.repeat(10000) });
    expect(r.message.length).toBe(10000);
  });

  it('rejects message longer than 10000', () => {
    expect(() => SendMessageBody.parse({ message: 'a'.repeat(10001) })).toThrow();
  });
});

describe('ConversationIdParam', () => {
  it('accepts 26-char string', () => {
    const r = ConversationIdParam.parse({ id: '01K40A8Y3V9E2XBSG5HMTVKQ11' });
    expect(r.id.length).toBe(26);
  });

  it('rejects wrong length', () => {
    expect(() => ConversationIdParam.parse({ id: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/intent/schema.test.ts
```

Expected:FAIL。

- [ ] **Step 3: 创建 `src/modules/intent/schema.ts`**

```typescript
import { z } from 'zod';

export const SendMessageBody = z.object({
  message: z.string().min(1).max(10000),
});
export type SendMessageBody = z.infer<typeof SendMessageBody>;

export const ConversationIdParam = z.object({
  id: z.string().length(26),
});
export type ConversationIdParam = z.infer<typeof ConversationIdParam>;
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/intent/schema.test.ts
```

Expected:PASS(7 条)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/intent/schema.ts test/unit/intent/schema.test.ts
git commit -m "feat(s3.1): add intent zod schemas"
```

---

## Task 10 · Intent Controller + Routes

**Files:**
- Create: `src/modules/intent/controllers/intent.controller.ts`
- Create: `src/modules/intent/routes.ts`

- [ ] **Step 1: 创建 Controller**

```typescript
import type { Request, Response, NextFunction } from 'express';
import type { AuthCtx } from '../../../middleware/require-session';
import type { IntentSessionService } from '../services/intent-session.service';
import { SendMessageBody, ConversationIdParam } from '../schema';
import { IntentMessageEmptyError } from '../domain/errors';

export class IntentController {
  constructor(private readonly intent: IntentSessionService) {}

  createSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const session = await this.intent.createSession(auth.userId);
      res.status(201).json({
        sessionId: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
      });
    } catch (e) { next(e); }
  };

  sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const body = SendMessageBody.parse(req.body ?? {});
      const result = await this.intent.sendMessage(auth.userId, id, body.message);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
```

- [ ] **Step 2: 创建 Routes**

```typescript
import { Router, type RequestHandler } from 'express';
import type { IntentController } from './controllers/intent.controller';

export function buildIntentRoutes(opts: {
  intentCtrl: IntentController;
  requireSession: RequestHandler;
}): Router {
  const r = Router();
  const { intentCtrl, requireSession } = opts;

  r.post('/sessions', requireSession, intentCtrl.createSession);
  r.post('/sessions/:id/messages', requireSession, intentCtrl.sendMessage);

  return r;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 4: Commit**

```bash
git add src/modules/intent/controllers/intent.controller.ts src/modules/intent/routes.ts
git commit -m "feat(s3.1): add intent controller + routes"
```

---

## Task 11 · 装配进 main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 追加 import**

在 S3.2 相关的 import 之后追加:

```typescript
import { NativeLlmClient } from './modules/llm/native';
import { ForgeService } from './modules/forge/forge.service';
import { IntentSessionService } from './modules/intent/services/intent-session.service';
import { IntentController } from './modules/intent/controllers/intent.controller';
import { buildIntentRoutes } from './modules/intent/routes';
```

- [ ] **Step 2: 在 buildApp() 里装配 intent 模块**

在 `void artifactService;` 之后追加:

```typescript
  // S3.1 intent capture
  const llmClient = new NativeLlmClient(cfg.llm.apiKey, cfg.llm.model);
  const forgeService = new ForgeService();
  const intentService = new IntentSessionService(memoryService, llmClient, forgeService);
  const intentCtrl = new IntentController(intentService);
```

- [ ] **Step 3: 挂路由**

在 `app.use('/api/memory', ...)` 之后追加:

```typescript
  app.use('/api/intent', buildIntentRoutes({
    intentCtrl,
    requireSession: requireSession(sessions, cfg.session.cookieName),
  }));
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 5: 起服务冒烟**

```bash
pnpm dev
```

验证:
- `curl http://localhost:<PORT>/api/intent/sessions -v` → `401 UNAUTHENTICATED`(鉴权生效)
- 按 Ctrl-C 停止。

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(s3.1): wire intent module into main.ts (+ LLM + Forge)"
```

---

## Task 12 · Integration 测试

**Files:**
- Create: `test/integration/intent/intent-session.service.int.test.ts`

> 用 testcontainers 起 MySQL,Mock LLM Client,测 service 完整流程(写记忆→读历史→LLM→写回复→判断触发)。

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { LlmClient, LlmResponse } from '../../../src/modules/llm/client';
import { IntentSessionService } from '../../../src/modules/intent/services/intent-session.service';
import { startTestDb } from '../setup';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { MessageRepository } from '../../../src/modules/memory/repositories/message.repository';
import { ForgeService } from '../../../src/modules/forge/forge.service';

let memoryService: MemoryService;
let intentService: IntentSessionService;
let cleanup: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  cleanup = ctx.destroy;
  const db = ctx.db;

  // seed user
  userId = '01K40A8Y3V9E2XBSG5HMTVKQ00';
  await db.insertInto('users').values({
    id: userId,
    email: `intent-test@${userId}.test`,
    email_verified: 0,
    password_hash: 'x',
    display_name: 'Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();

  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  memoryService = new MemoryService(conversationRepo, messageRepo, db);
}, 120_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('messages').execute();
  await db.deleteFrom('conversations').execute();
});

// Mock LLM that returns clarification
const clarifyingLlm = (responseText: string): LlmClient => ({
  complete: vi.fn(async () => ({ content: responseText }) as LlmResponse),
});

// Mock LLM that returns executable
const executableLlm = (responseText: string, description: string): LlmClient => ({
  complete: vi.fn(async () => ({
    content: `${responseText}\n__EXECUTE__\n{ "description": "${description}" }`,
  } as LlmResponse)),
});

describe('IntentSessionService integration', () => {
  it('createSession creates a conversation with intent: title', async () => {
    const service = new IntentSessionService(
      memoryService,
      clarifyingLlm('ok'),
      new ForgeService(),
    );
    const s = await service.createSession(userId);
    expect(s.title).toContain('intent:');
    expect(s.userId).toBe(userId);
  });

  it('sendMessage writes user+AI messages to memory and returns clarifying response', async () => {
    const llm = clarifyingLlm('请问具体是什么功能?');
    const service = new IntentSessionService(memoryService, llm, new ForgeService());
    const session = await service.createSession(userId);

    const result = await service.sendMessage(userId, session.id, '我想做个记账 app');

    expect(result.status).toBe('clarifying');
    expect(result.intent).toBeNull();
    expect(result.message).toBe('请问具体是什么功能?');

    // Verify memory has both messages
    const msgs = await memoryService.listMessages(userId, session.id, { limit: 10 });
    expect(msgs.items.map(m => m.role)).toEqual(['user', 'system']);
    expect(msgs.items[0].content).toBe('我想做个记账 app');
    expect(msgs.items[1].content).toBe('请问具体是什么功能?');
  });

  it('sendMessage with executable intent calls forge and returns triggered', async () => {
    const forge = new ForgeService();
    const triggerSpy = vi.spyOn(forge, 'triggerFromIntent');
    const llm = executableLlm('好的,开始生成。', '记账 app');
    const service = new IntentSessionService(memoryService, llm, forge);
    const session = await service.createSession(userId);

    const result = await service.sendMessage(userId, session.id, '我要一个记账 app');

    expect(result.status).toBe('triggered');
    expect(result.intent).toEqual({ description: '记账 app', form: 'web' });
    expect(triggerSpy).toHaveBeenCalledOnce();
    expect(triggerSpy).toHaveBeenCalledWith(session.id, session.id, {
      description: '记账 app',
      form: 'web',
    });
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test:integration test/integration/intent/intent-session.service.int.test.ts
```

Expected:PASS 3 条。

- [ ] **Step 3: Commit**

```bash
git add test/integration/intent/intent-session.service.int.test.ts
git commit -m "test(s3.1): intent service integration suite (memory + llm mock + forge)"
```

---

## Task 13 · E2E 测试

**Files:**
- Create: `test/e2e/intent.e2e.test.ts`

> 复用 S2 的 e2e 模式:supertest + login 拿 cookie。

- [ ] **Step 1: 读一下 `test/e2e/auth.e2e.test.ts` 的 helper 写法**

```bash
cat test/e2e/auth.e2e.test.ts | head -40
```

按实际写的套路调整下面代码。

- [ ] **Step 2: 创建测试**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
// 按 test/e2e/auth.e2e.test.ts 的实际 helper 调整下面
import { buildTestApp, type TestAppCtx } from './setup';

let ctx: TestAppCtx;
let app: Express;
let userCookie: string;

beforeAll(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  // 用 ctx.services.auth.createUser 创建用户并 login
  // 参考 test/e2e/auth.e2e.test.ts 的模式
  // 以下是示意代码,执行时按实际调整:
  const email = `intent-e2e@test.${Date.now()}.com`;
  const password = 'CorrectHorseBatteryStaple9!';
  await ctx.services.auth.createUser({ email, password, displayName: 'E2E Intent' });
  const login = await request(app).post('/api/auth/login').send({ email, password });
  userCookie = login.headers['set-cookie'][0];
}, 180_000);

afterAll(async () => { await ctx.shutdown(); });

describe('Intent API', () => {
  it('returns 401 without cookie', async () => {
    const r = await request(app).post('/api/intent/sessions').send({});
    expect(r.status).toBe(401);
  });

  it('creates session and returns sessionId', async () => {
    const r = await request(app).post('/api/intent/sessions').set('Cookie', userCookie).send({});
    expect(r.status).toBe(201);
    expect(r.body.sessionId).toBeDefined();
    expect(r.body.sessionId.length).toBe(26);
    return r.body.sessionId;  // 存给下一个测试用
  });

  it('sends message and returns LLM clarifying response', async () => {
    const sessionId = (await request(app).post('/api/intent/sessions')
      .set('Cookie', userCookie).send({}).body.sessionId;
    const r = await request(app)
      .post(`/api/intent/sessions/${sessionId}/messages`)
      .set('Cookie', userCookie)
      .send({ message: '我要做一个记账 app' });
    expect(r.status).toBe(200);
    expect(r.body.message).toBeDefined();
    expect(r.body.status).toBeOneOf(['clarifying', 'triggered']); // 看 mock 的 LLM 返回什么
    expect(r.body.sessionId).toBeUndefined(); // /messages 不返回 sessionId
  });

  it('rejects empty message with 400', async () => {
    const sessionId = (await request(app).post('/api/intent/sessions')
      .set('Cookie', userCookie).send({}).body.sessionId;
    const r = await request(app)
      .post(`/api/intent/sessions/${sessionId}/messages`)
      .set('Cookie', userCookie)
      .send({ message: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});
```

**实际写法**:上面是示意,`buildTestApp` / `ctx.services.auth.createUser` 等具体 API 按 `test/e2e/auth.e2e.test.ts` 的实际代码调整。不要引入新的 helper 写法。

- [ ] **Step 3: 跑测试**

```bash
pnpm test:e2e test/e2e/intent.e2e.test.ts
```

Expected:PASS。

- [ ] **Step 4: Commit**

```bash
git add test/e2e/intent.e2e.test.ts
git commit -m "test(s3.1): e2e suite for intent API (auth + sessions + messages)"
```

---

## Task 14 · 全量测试

**Files:** 无

- [ ] **Step 1: 全量 typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 2: 全量 unit**

```bash
pnpm test:unit
```

Expected:全 PASS。

- [ ] **Step 3: 全量 integration**

```bash
pnpm test:integration
```

Expected:全 PASS。

- [ ] **Step 4: 全量 e2e**

```bash
pnpm test:e2e
```

Expected:全 PASS。

- [ ] **Step 5: 无 commit,全绿进入 Task 15**

---

## Task 15 · Smoke 清单

**Files:**
- Create: `docs/qa/s3-1-intent-manual-checklist.md`

> 和 S2 smoke 模板对齐。

```markdown
# S3.1 · 手工 smoke 清单

前提:`.env` 有 `LLM_API_KEY` / `LLM_MODEL`;服务 `pnpm dev` 已启动。

## 1. 鉴权

- [ ] 无 cookie → `POST /api/intent/sessions` → 401
- [ ] 无 cookie → `POST /api/intent/sessions/:id/messages` → 401

## 2. 创建会话

- [ ] `POST /api/intent/sessions` → 201 + `sessionId`(26 字符)
- [ ] 返回 `userId` 和 `createdAt`

## 3. 发送消息(LLM 追问)

- [ ] 发送一个模糊需求 → 返回追问内容
- [ ] 对话进了 S2.1:GET `/api/memory/conversations/:id/messages` 有两条(用户+AI)

## 4. 发送消息(LLM 触发)

- [ ] 多轮对话后 LLM 触发 → `status: "triggered"` + `intent.description`
- [ ] 触发后 Forge stub 打印 log `[forge stub]`

## 5. 验证

- [ ] `/api/memory/conversations/:id/messages` 看到完整对话历史
```

- [ ] **Commit**

```bash
git add docs/qa/s3-1-intent-manual-checklist.md
git commit -m "docs(s3.1): add manual smoke checklist"
```

---

## Task 16 · README 更新

**Files:**
- Modify: `README.md`

在"当前状态"章节追加:

```markdown
- M2 平台契约 + 入口:S3.2 产物模型 ✅ + S3.1 意图捕获 ✅(多轮追问 + LLM 自动触发,Forge stub)
```

- [ ] **Commit**

```bash
git add README.md
git commit -m "docs: mark S3.1 complete in README"
```

---

## Task 17 · 分支收尾

**Files:** 无

- [ ] **Step 1: 检查 commit 结构**

```bash
git log --oneline main..HEAD
```

Expected:约 15 条 commit。

- [ ] **Step 2: working tree 干净**

```bash
git status
```

- [ ] **Step 3: 报告**

---

## Self-Review 记录

1. **Spec 覆盖**:
   - 双 HTTP 端点 → Task 10 controller + routes
   - 多轮 LLM 追问 → Task 7 service + parseLlmOutput
   - 记忆存储 → Task 7 service 复用 MemoryService
   - LLM 接口抽象 → Task 2 interface + Task 4 native
   - Forge stub → Task 5
   - 非 streaming → spec 确认,无 streaming 代码
   - 同步触发 → Task 7 service 逻辑,Task 12 integration 验证
   - System prompt → Task 3
   - E2E 验证对话进记忆 → Task 13

2. **类型一致性**:
   - `LlmClient.complete` → `LlmMessage[] → Promise<LlmResponse>` Task 2 定义,Task 4/7/12 一致
   - `IntentSessionService.sendMessage` 返回 → `SendMessageResult` Task 7 定义
   - MemoryService 方法签名从 S2 已有,Task 7 复用,无新增定义

3. **Placeholder 扫描**:无 TBD/TODO/implement later;每个 step 有完整代码;Task 13 e2e 测试是示意代码(`buildTestApp`/`ctx.services.auth` 按实际调整)是**技术说明**而非 placeholder

---

**Plan 写完**。
