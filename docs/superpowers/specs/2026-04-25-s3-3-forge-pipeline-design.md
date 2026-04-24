# S3.3 · 生成流水线(Forge Pipeline)设计

> **范围**:moon-agent-os 平台 L3 层 Forge & Runtime 的 S3.3 生成流水线子系统。Vision 文档里程碑 M2 的一部分。
>
> **定位**:把 S3.1 捕获的结构化意图变成可运行的产物，存进 S3.2。流水线首尾相接的最后一步。

**生成日期**: 2026-04-25
**依赖**: S3.1 意图捕获 / S3.2 产物模型(全部已完成)
**并行**: M2 其他子系统
**参考**: `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`

---

## 一、目标与边界

### S3.3 要交付什么

把 S3.1 触发的意图变成可运行的网页产物，存进 S3.2 artifact 表。

**核心流程**:
```
S3.1.triggerFromIntent()
        │
        ▼
  ForgeService.triggerFromIntent()
        │
        ├─► LlmClient.complete(prompt)  ──► LLM API
        │
        ├─► ArtifactService.create()   ──► MySQL artifacts 表
        │
        └─► MemoryService.addMessage() ──► S2.1 记忆
```

**必须具备**:
- `ForgeService.triggerFromIntent()`:接 `description` + `form`，触发生成
- LLM 直译生成 `entryHtml` + `assets` + `metadata`
- 自动生成 `title`（`Web App: ` + description 前 50 字）
- 生成完成后写消息到 S2.1 记忆
- 失败时抛错，不存 artifact

**明确不做**(留给未来):
- ❌ 模板填充（M2 只有 LLM 直译）
- ❌ 异步队列 / 后台生成（M2 同步完成）
- ❌ 多种形态（M2 只有 `web`）
- ❌ 生成质量调优（M3 迭代循环再做）

---

## 二、关键决策

| # | 维度 | 决策 | 理由 |
|---|---|---|---|
| 1 | 生成策略 | LLM 直译 | M2 目标是跑通流水线，不是做好质量；M3 迭代循环是质量杠杆 |
| 2 | 质量目标 | 适中（基本质量约束） | 投入不大但明显提升；太简陋体验差，太精细调优成本高 |
| 3 | title 来源 | `Web App: ` + description 前 50 字 | 不增加 LLM 调用；有格式感；M3 可升级 |
| 4 | 生成失败 | 抛错，不存 artifact | artifact 是产物，不应该有"失败产物"；让用户重试是正确心智 |
| 5 | 完成通知 | 写消息到 S2.1 记忆 | 复用 S2.1，体验一致；不需要前端轮询 |
| 6 | prompt 内容 | description + 基本质量约束 | 平衡控制力与复杂度；M2 足够 |
| 7 | origin | 固定 `user_intent` | M2 只有 S3.1 触发；`iteration` 是 M3 S3.5 的事 |
| 8 | LLM 配置 | 复用 S3.1 的 LlmClient | M2 不需要区分生成和追问模型；复用减少配置 |
| 9 | 篇幅控制 | 不限制 | LLM max_tokens 已约束源头；M3 再调 |
| 10 | 消息内容 | 包含产物 ID | 用户拿到 ID 可直接操作；B 是最小可用信息 |
| 11 | 目录结构 | 与 S3.1/S3.2 对齐 | 新成员学习成本低；generators/ 可扩展多形态 |
| 12 | 测试策略 | Unit + Integration | E2E 已被 S3.1 覆盖；Integration 用 mock LLM 测完整流程 |

---

## 三、架构

### 数据流

```
                    ┌──────────────────────────────────────┐
  S3.1 触发 ──────► │  ForgeService.triggerFromIntent()   │
                    │                                      │
                    │  ┌────────────────────────────────┐   │
                    │  │ 1. buildWebPrompt(description) │   │
                    │  └───────────────┬────────────────┘   │
                    │                  │                   │
                    │                  ▼                   │
                    │  ┌────────────────────────────────┐   │
                    │  │ 2. LlmClient.complete(messages)│   │
                    │  └───────────────┬────────────────┘   │
                    │                  │                   │
                    │                  ▼                   │
                    │  ┌────────────────────────────────┐   │
                    │  │ 3. parseWebResponse(content)   │   │
                    │  └───────────────┬────────────────┘   │
                    │                  │                   │
                    │                  ▼                   │
                    │  ┌────────────────────────────────┐   │
                    │  │ 4. ArtifactService.create()    │   │
                    │  └───────────────┬────────────────┘   │
                    │                  │                   │
                    │                  ▼                   │
                    │  ┌────────────────────────────────┐   │
                    │  │ 5. MemoryService.addMessage()   │   │
                    │  └────────────────────────────────┘   │
                    └──────────────────────────────────────┘
```

### 目录结构

```
src/modules/forge/
├── services/
│   └── forge.service.ts           # 主服务：triggerFromIntent
├── generators/
│   └── web.generator.ts           # web 形态生成器
├── domain/
│   └── errors.ts                  # ForgeGenerationError
└── prompts/
    └── web.prompt.ts              # prompt 模板配置

src/config/
└── forge-prompt.ts                # system prompt 可调优配置
```

### 依赖关系

```
ForgeService 依赖:
  - LlmClient (S3.1 已建)
  - ArtifactService (S3.2 已建)
  - MemoryService (S2.1 已建)
```

---

## 四、核心代码

### ForgeService

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
    const { description, form } = input;

    // 1. 生成代码
    const response = await this.llm.complete(buildWebPrompt(description));
    let parsed: { entryHtml: string; assets: Record<string, string> };

    try {
      parsed = parseWebResponse(response.content);
    } catch {
      throw new ForgeGenerationError('LLM 响应格式错误，无法解析为 JSON');
    }

    // 2. 存 artifact
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

    // 3. 写回记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: `产物已生成：${artifact.title}，ID: ${artifact.id}`,
    });
  }
}
```

### WebGenerator

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

### Domain 错误

```typescript
// src/modules/forge/domain/errors.ts

import { AppError } from '../../../core/errors';

export class ForgeGenerationError extends AppError {
  readonly code = 'FORGE_GENERATION_ERROR';
  readonly status = 500;
  constructor(message: string) { super(message); }
}
```

### Prompt 配置

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

---

## 五、S3.1 适配

S3.1 的 `ForgeService` stub 需要替换为真实实现。

**改动点**:

1. 删除 `src/modules/forge/forge.service.ts` 的 stub 内容
2. 替换为上方 `ForgeService` 实现
3. `main.ts` 装配时注入 `artifactService` + `memoryService`

```typescript
// main.ts 装配变化

// 之前（S3.1 stub）:
// const forge = new ForgeService();

// 之后（S3.3 实现）:
const forge = new ForgeService(
  llmClient,          // S3.1 已建
  artifactService,    // S3.2 已建
  memoryService,      // S2.1 已建
);
```

**注意**:`IntentSessionService` 依赖 `ForgeService`，不需要改动。

---

## 六、错误处理

| 场景 | 行为 |
|---|---|
| LLM API 超时/失败 | 抛 `ForgeGenerationError`，S3.1 返回 500 |
| LLM 响应格式错误 | 抛 `ForgeGenerationError` |
| Artifact 创建失败 | 抛 `InvalidPayloadError`（S3.2），向上透传 |
| 写记忆失败 | 抛 `MemoryWriteError`（S2.1），向上透传 |

**S3.1 错误传播**:所有错误透传到 `IntentController`，由 `errorHandler` 统一处理。

---

## 七、测试策略

### Unit (`test/unit/forge/`)

**`web.generator.test.ts`**:
- `buildWebPrompt`: 返回正确的 system + user 结构；description 被正确放入 user 消息
- `parseWebResponse`:
  - 合法 JSON → 返回 `{ entryHtml, assets }`
  - 响应中带额外文字 → 仍能提取 JSON
  - 缺 `entryHtml` 字段 → 抛 Error
  - 非法 JSON → 抛 Error

**`forge.service.test.ts`** (mock llm + mock artifact + mock memory):
- LLM 返回合法 JSON → artifact.create 被调用，参数正确
- LLM 返回非法 JSON → 抛 `ForgeGenerationError`，artifact.create 不被调用
- artifact.create 成功后 → memory.addMessage 被调用，content 包含 artifact.id
- title 生成：`description.substring(0, 50)` 长度正确

### Integration (`test/integration/forge/`)

**`forge.service.int.test.ts`**:
- 真实 LLM mock（返回预置合法 JSON）
- 完整流程：生成 → 存 artifact → 写记忆
- 验证 artifact 表有新增行（`kind='web'`, `origin='user_intent'`）
- 验证 messages 表有新消息（content 包含 artifact.id）

---

## 八、非功能性约束

| 维度 | 约束 |
|---|---|
| **性能** | LLM 调用是主要延迟（10-30 秒）；M2 不做缓存 |
| **安全** | LLM 输出直接作为 `entryHtml` 存入 DB；S4.1 运行时做沙箱隔离 |
| **可观测** | LLM 调用打日志（耗时）；生成失败打 warn |
| **错误恢复** | 生成失败用户重试即可；不需要重试逻辑 |

---

## 九、与未来里程碑的接口

| 里程碑 | 变化 |
|---|---|
| M3 S3.5 | `origin='iteration'`；读取运行反馈影响生成 |
| M3 S3.3 升级 | 更好的 prompt 调优；可能加模板兜底 |
| M4 形态扩展 | 加 `app.generator.ts` / `mcp.generator.ts` |
| M4 S4.1 | artifact 运行时沙箱隔离 |

---

## 十、实现顺序提示（给 writing-plans）

1. `ForgeGenerationError` 错误类
2. `web.generator.ts`（prompt 构造 + 响应解析）+ unit 测试
3. `forge.service.ts`（主服务）+ unit 测试
4. `main.ts` 装配更新（注入 artifactService + memoryService）
5. Integration 测试
6. Typecheck + 全量测试绿

---

*本设计基于 2026-04-25 brainstorming 对话生成。12 个决策见第二节。*
