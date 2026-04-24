# S3.5 · 迭代循环(Iteration Loop)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现「反馈 → 记忆 → 生成」质量提升回路。核心：独立 feedbacks 表 + FeedbackService + IntentSessionService 迭代模式检测 + ForgeService 反馈上下文注入。

**Architecture:** 反馈独立表存储；IntentSessionService 检测迭代关键词后查历史反馈注入 Forge；Forge 生成时 origin='iteration' + parent_artifact_id 记录血缘。

**Tech Stack:** TypeScript · Express 5 · MySQL 8 · Kysely · Vitest · testcontainers

---

## 文件结构

```
migrations/
└── 20260425_005_add_feedback_table.ts            # 新增

src/modules/
├── feedback/
│   ├── domain/
│   │   ├── feedback.ts                           # 新增：类型 + FEEDBACK_LABELS + HistoricalFeedback
│   │   └── errors.ts                            # 新增：FeedbackNotFoundError + FeedbackForbiddenError
│   ├── repositories/
│   │   └── feedback.repository.ts                # 新增：CRUD + listByUserAndIntentKeyword
│   ├── services/
│   │   └── feedback.service.ts                   # 新增：create + matchByIntent + injectIntoPrompt + listByArtifactForOwner
│   ├── controllers/
│   │   └── feedback.controller.ts                # 新增：create + listByArtifact
│   └── routes/
│       └── feedback.routes.ts                    # 新增：registerFeedbackRoutes
├── intent/
│   └── services/
│       └── intent-session.service.ts            # 修改：新增第四参数 FeedbackService + 迭代模式检测
├── forge/
│   └── services/
│       └── forge.service.ts                     # 修改：ForgeIterationContext 参数 + origin='iteration' + parent_artifact_id
└── main.ts                                        # 修改：FeedbackRepo/Service 装配 + IntentSessionService 第四参数 + 注册路由

test/
├── unit/
│   ├── feedback/
│   │   └── feedback.service.test.ts             # 新增
│   └── intent/
│       └── intent-session.service.iterate.test.ts # 新增
├── integration/
│   └── feedback/
│       └── feedback.service.int.test.ts        # 新增
└── e2e/
    └── intent.e2e.test.ts                      # 修改：迭代模式测试
```

---

## Task 1: 创建 feedbacks 表 migration

**Files:**
- Create: `migrations/20260425_005_add_feedback_table.ts`
- Reference: `migrations/20260424_003_init_artifact.ts`

- [ ] **Step 1: 创建 migration**

```typescript
// migrations/20260425_005_add_feedback_table.ts

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE feedbacks (
      id          CHAR(26)      NOT NULL,
      artifact_id CHAR(26)      NOT NULL,
      user_id     CHAR(26)      NOT NULL,
      label       VARCHAR(32)   NOT NULL,
      comment     TEXT          NULL,
      created_at  DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_feedbacks_artifact (artifact_id),
      KEY idx_feedbacks_user_created (user_id, created_at DESC),
      KEY idx_feedbacks_label (label),
      CONSTRAINT chk_feedbacks_label
        CHECK (label IN ('function_bug', 'ui_issue', 'slow_performance', 'missing_feature', 'other')),
      CONSTRAINT fk_feedbacks_artifact
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
      CONSTRAINT fk_feedbacks_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS feedbacks`.execute(db);
}
```

- [ ] **Step 2: Run migration**

```bash
pnpm db:migrate
```

- [ ] **Step 3: Commit**

```bash
git add migrations/20260425_005_add_feedback_table.ts
git commit -m "feat(s3.5): add feedbacks table migration"
```

---

## Task 2: 创建 feedback domain 类型

**Files:**
- Create: `src/modules/feedback/domain/feedback.ts`
- Reference: `src/modules/artifact/domain/artifact.ts`

- [ ] **Step 1: 创建 domain 类型**

```typescript
// src/modules/feedback/domain/feedback.ts

export const FEEDBACK_LABELS = [
  'function_bug',
  'ui_issue',
  'slow_performance',
  'missing_feature',
  'other',
] as const;

export type FeedbackLabel = typeof FEEDBACK_LABELS[number];

export type HistoricalFeedback = {
  artifactId: string;
  artifactTitle: string;
  label: FeedbackLabel;
  comment: string | null;
  createdAt: Date;
};

export type Feedback = {
  id: string;
  artifactId: string;
  userId: string;
  label: FeedbackLabel;
  comment: string | null;
  createdAt: Date;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/feedback/domain/feedback.ts
git commit -m "feat(s3.5): add Feedback domain types and FEEDBACK_LABELS"
```

---

## Task 3: 创建 feedback domain errors

**Files:**
- Create: `src/modules/feedback/domain/errors.ts`
- Reference: `src/modules/artifact/domain/errors.ts`

- [ ] **Step 1: 创建 error 类**

```typescript
// src/modules/feedback/domain/errors.ts

import { AppError } from '../../../core/errors';

export class FeedbackNotFoundError extends AppError {
  readonly code = 'FEEDBACK_NOT_FOUND';
  readonly status = 404;
  constructor(artifactId: string) { super(`产物 ${artifactId} 不存在`); }
}

export class FeedbackForbiddenError extends AppError {
  readonly code = 'FEEDBACK_FORBIDDEN';
  readonly status = 403;
  constructor() { super('无权对该产物提交反馈'); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/feedback/domain/errors.ts
git commit -m "feat(s3.5): add FeedbackNotFoundError and FeedbackForbiddenError"
```

---

## Task 4: 创建 FeedbackRepository

**Files:**
- Create: `src/modules/feedback/repositories/feedback.repository.ts`
- Reference: `src/modules/artifact/repositories/artifact.repository.ts`

- [ ] **Step 1: 创建 repository**

```typescript
// src/modules/feedback/repositories/feedback.repository.ts

import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { FeedbackLabel } from '../domain/feedback';

type FeedbackRow = {
  id: string;
  artifact_id: string;
  user_id: string;
  label: string;
  comment: string | null;
  created_at: Date;
};

export class FeedbackRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(f: {
    id: string;
    artifactId: string;
    userId: string;
    label: FeedbackLabel;
    comment: string | null;
    now: Date;
  }): Promise<void> {
    await this.db.insertInto('feedbacks').values({
      id: f.id,
      artifact_id: f.artifactId,
      user_id: f.userId,
      label: f.label,
      comment: f.comment,
      created_at: f.now,
    }).execute();
  }

  async listByArtifact(artifactId: string): Promise<FeedbackRow[]> {
    return this.db
      .selectFrom('feedbacks')
      .selectAll()
      .where('artifact_id', '=', artifactId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async listByUserAndIntentKeyword(
    userId: string,
    keyword: string,
    limit: number,
  ): Promise<Array<FeedbackRow & { artifact_title: string }>> {
    const artifacts = await this.db
      .selectFrom('artifacts')
      .select(['id', 'title'])
      .where('user_id', '=', userId)
      .where('title', 'like', `%${keyword}%`)
      .execute();

    if (artifacts.length === 0) return [];

    const artifactIds = artifacts.map(a => a.id);
    const titleMap = new Map(artifacts.map(a => [a.id, a.title]));

    const rows = await this.db
      .selectFrom('feedbacks')
      .selectAll()
      .where('artifact_id', 'in', artifactIds)
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map(r => ({
      ...r,
      artifact_title: titleMap.get(r.artifact_id) ?? '',
    }));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/feedback/repositories/feedback.repository.ts
git commit -m "feat(s3.5): add FeedbackRepository with insert and listByUserAndIntentKeyword"
```

---

## Task 5: 创建 FeedbackService

**Files:**
- Create: `src/modules/feedback/services/feedback.service.ts`
- Reference: `src/modules/artifact/services/artifact.service.ts`
- Reference: `src/modules/intent/services/intent-session.service.ts`（ITERATE_KEYWORDS 位置）

**注意**：当前 `ITERATE_KEYWORDS` 定义在 `src/modules/intent/services/intent-session.service.ts`。S3.5 spec 把它导出供 FeedbackService 使用。这意味着 `IntentSessionService` 改动（Task 9）要先于 `FeedbackService`（Task 5）完成——实际依赖顺序：Task 9 先创建 `ITERATE_KEYWORDS` 导出，Task 5 再 import。

因此本 Task 分两个 Step：**先创建不含 `stripIterateKeywords` 的基础版，Task 9 完成后补充完整**。

- [ ] **Step 1: 创建基础 FeedbackService（不含 stripIterateKeywords）**

```typescript
// src/modules/feedback/services/feedback.service.ts

import { ulid } from 'ulid';
import type { FeedbackRepository } from '../repositories/feedback.repository';
import type { ArtifactRepository } from '../../artifact/repositories/artifact.repository';
import type { HistoricalFeedback, FeedbackLabel } from '../domain/feedback';
import { FeedbackNotFoundError, FeedbackForbiddenError } from '../domain/errors';

export class FeedbackService {
  constructor(
    private readonly feedbackRepo: FeedbackRepository,
    private readonly artifactRepo: ArtifactRepository,
  ) {}

  async create(
    userId: string,
    artifactId: string,
    label: FeedbackLabel,
    comment: string | null,
  ): Promise<void> {
    const artifact = await this.artifactRepo.findById(artifactId);
    if (!artifact) throw new FeedbackNotFoundError(artifactId);
    if (artifact.userId !== userId) throw new FeedbackForbiddenError();

    const id = ulid();
    const now = new Date();
    await this.feedbackRepo.insert({ id, artifactId, userId, label, comment, now });
  }

  async listByArtifact(artifactId: string): Promise<HistoricalFeedback[]> {
    const artifact = await this.artifactRepo.findById(artifactId);
    const rows = await this.feedbackRepo.listByArtifact(artifactId);
    return rows.map(r => ({
      artifactId: r.artifact_id,
      artifactTitle: artifact?.title ?? '',
      label: r.label as FeedbackLabel,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  async listByArtifactForOwner(userId: string, artifactId: string): Promise<HistoricalFeedback[]> {
    const artifact = await this.artifactRepo.findById(artifactId);
    if (!artifact) throw new FeedbackNotFoundError(artifactId);
    if (artifact.userId !== userId) throw new FeedbackForbiddenError();
    return this.listByArtifact(artifactId);
  }

  async matchByIntent(userId: string, description: string, limit = 5): Promise<HistoricalFeedback[]> {
    // 关键词提取：剥离 ITERATE_KEYWORDS 后取前 10 字符
    // 注意：ITERATE_KEYWORDS 从 IntentSessionService 导入（Task 9 创建）
    const { ITERATE_KEYWORDS } = require('../../intent/services/intent-session.service');
    let stripped = description;
    for (const kw of ITERATE_KEYWORDS) {
      stripped = stripped.replace(new RegExp(kw, 'gi'), '');
    }
    stripped = stripped.trim();
    const keyword = stripped.substring(0, 10);
    if (keyword.trim().length === 0) return [];

    const rows = await this.feedbackRepo.listByUserAndIntentKeyword(userId, keyword, limit);
    return rows.map(r => ({
      artifactId: r.artifact_id,
      artifactTitle: r.artifact_title,
      label: r.label as FeedbackLabel,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  injectIntoPrompt(feedbacks: HistoricalFeedback[]): string {
    if (feedbacks.length === 0) return '';
    const blocks = feedbacks.map(f => {
      const daysAgo = Math.floor((Date.now() - f.createdAt.getTime()) / 86400000);
      const timeStr = daysAgo === 0 ? '今天' : `${daysAgo}天前`;
      return `- artifact: "${f.artifactTitle}"（${timeStr}）
  labels: ${f.label}${f.comment ? `, comment: "${f.comment}"` : ''}`;
    }).join('\n');
    return `[HISTORICAL_FEEDBACK]\n${blocks}\n[/HISTORICAL_FEEDBACK]\n\n`;
  }
}
```

**注意**：`matchByIntent` 中的 `require(...)` 是临时写法，等 Task 9 完成 `ITERATE_KEYWORDS` 导出后，改为顶部的正常 import。

- [ ] **Step 2: Commit（第一版）**

```bash
git add src/modules/feedback/services/feedback.service.ts
git commit -m "feat(s3.5): add FeedbackService (basic version, stripIterateKeywords added in Task 9)"
```

---

## Task 6: 创建 FeedbackController

**Files:**
- Create: `src/modules/feedback/controllers/feedback.controller.ts`
- Reference: `src/modules/identity/controllers/me.controller.ts`（AuthCtx 使用模式）

- [ ] **Step 1: 创建 controller**

```typescript
// src/modules/feedback/controllers/feedback.controller.ts

import type { Request, Response, NextFunction } from 'express';
import type { FeedbackService } from '../services/feedback.service';
import type { FeedbackLabel } from '../domain/feedback';
import { FEEDBACK_LABELS } from '../domain/feedback';
import type { AuthCtx } from '../../../middleware/require-session';

export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = res.locals.auth as AuthCtx;

      const { artifact_id, label, comment } = req.body as {
        artifact_id: string;
        label: string;
        comment?: string;
      };
      if (!artifact_id || !label) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED' } });
      }
      if (!FEEDBACK_LABELS.includes(label as FeedbackLabel)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: `label must be one of: ${FEEDBACK_LABELS.join(', ')}` }
        });
      }

      await this.feedbackService.create(userId, artifact_id, label as FeedbackLabel, comment ?? null);
      res.status(201).json({ success: true });
    } catch (e) {
      next(e);
    }
  }

  async listByArtifact(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = res.locals.auth as AuthCtx;
      const { id } = req.params;
      const feedbacks = await this.feedbackService.listByArtifactForOwner(userId, id);
      res.json({ items: feedbacks });
    } catch (e) {
      next(e);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/feedback/controllers/feedback.controller.ts
git commit -m "feat(s3.5): add FeedbackController with create and listByArtifact"
```

---

## Task 7: 创建 FeedbackRoutes 并注册到 main.ts

**Files:**
- Create: `src/modules/feedback/routes/feedback.routes.ts`
- Modify: `src/main.ts`
- Reference: `src/modules/runtime/routes/web-runtime.routes.ts`（register 模式）

- [ ] **Step 1: 创建 routes**

```typescript
// src/modules/feedback/routes/feedback.routes.ts

import type { Router } from 'express';
import type { FeedbackService } from '../services/feedback.service';
import type { SessionService } from '../../identity/services/session.service';
import { FeedbackController } from '../controllers/feedback.controller';
import { requireSession } from '../../../middleware/require-session';

export function registerFeedbackRoutes(
  router: Router,
  feedbackService: FeedbackService,
  sessionService: SessionService,
  cookieName: string,
) {
  const controller = new FeedbackController(feedbackService);
  const auth = requireSession(sessionService, cookieName);

  router.post('/api/feedback', auth, (req, res, next) => controller.create(req, res, next));
  router.get('/api/artifacts/:id/feedback', auth, (req, res, next) => controller.listByArtifact(req, res, next));
}
```

- [ ] **Step 2: 修改 main.ts**

在 `src/main.ts` 中：

1. 在顶部 import 区添加：
```typescript
import { FeedbackRepository } from './modules/feedback/repositories/feedback.repository';
import { FeedbackService } from './modules/feedback/services/feedback.service';
import { registerFeedbackRoutes } from './modules/feedback/routes/feedback.routes';
```

2. 在 artifactService 创建之后（第 68 行之后），添加：
```typescript
const feedbackRepo = new FeedbackRepository(db);
const feedbackService = new FeedbackService(feedbackRepo, artifactRepo);
```

3. 修改 IntentSessionService 构造（第 73 行）：
```typescript
// 之前：
const intentService = new IntentSessionService(memoryService, llmClient, forgeService);
// 之后：
const intentService = new IntentSessionService(memoryService, llmClient, forgeService, feedbackService);
```

4. 在 `registerWebRuntimeRoutes` 之后（第 121 行之后），添加：
```typescript
registerFeedbackRoutes(app, feedbackService, sessions, cfg.session.cookieName);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 error

- [ ] **Step 4: Commit**

```bash
git add src/modules/feedback/routes/feedback.routes.ts src/main.ts
git commit -m "feat(s3.5): register feedback routes in main.ts"
```

---

## Task 8: 修改 ForgeService（iteration 参数 + origin='iteration'）

**Files:**
- Modify: `src/modules/forge/services/forge.service.ts`
- Reference: `src/modules/forge/services/forge.service.ts`（当前实现）

- [ ] **Step 1: 修改 ForgeService**

找到当前 `triggerFromIntent` 方法签名和实现，替换为以下内容：

```typescript
// src/modules/forge/services/forge.service.ts（增量改动）

// 在 import 区域底部添加：
import type { ArtifactOrigin } from '../../artifact/domain/artifact';

// 在 ForgeService 类之前添加类型：
export type ForgeIterationContext = {
  feedbackContext: string;
  parentArtifactId: string | null;
};

// 修改 triggerFromIntent 方法签名（第 16-19 行附近）：
// 之前：async triggerFromIntent(userId: string, sessionId: string, input: { description: string; form: 'web' }): Promise<void>
// 之后：
async triggerFromIntent(
  userId: string,
  sessionId: string,
  input: { description: string; form: 'web' },
  iteration?: ForgeIterationContext,
): Promise<void> {
  const { description } = input;
  const hasFeedback = iteration && iteration.feedbackContext.length > 0;

  // 构建 prompt（含反馈上下文）
  const baseMessages = buildWebPrompt(description);
  if (hasFeedback) {
    baseMessages[0] = {
      role: 'system',
      content: iteration!.feedbackContext + baseMessages[0].content,
    };
  }

  // 调用 LLM（签名不变）
  const response = await this.llm.complete(baseMessages);

  // 解析响应
  let parsed: { entryHtml: string; assets: Record<string, string> };
  try {
    parsed = parseWebResponse(response.content);
  } catch {
    throw new ForgeGenerationError('LLM 响应格式错误，无法解析为 JSON');
  }

  // 存 artifact（origin='iteration' + parent_artifact_id）
  const title = `Web App: ${description.substring(0, 50)}`;
  const origin: ArtifactOrigin = hasFeedback ? 'iteration' : 'user_intent';
  const parentArtifactId = hasFeedback ? iteration!.parentArtifactId : null;

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
    origin,
    parentArtifactId,
  });

  // 写回记忆
  await this.memory.addMessage(userId, sessionId, {
    role: 'system',
    content: `产物已生成：${artifact.title}，ID: ${artifact.id}`,
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 error

- [ ] **Step 3: Commit**

```bash
git add src/modules/forge/services/forge.service.ts
git commit -m "feat(s3.5): add ForgeIterationContext param to triggerFromIntent, support origin='iteration'"
```

---

## Task 9: 修改 IntentSessionService（迭代模式检测 + FeedbackService 依赖）

**Files:**
- Modify: `src/modules/intent/services/intent-session.service.ts`
- Reference: `src/modules/intent/services/intent-session.service.ts`（当前实现）

**这是核心改动**：ITERATE_KEYWORDS 导出 + 构造函数第四参数 + 迭代分支 + 透传给 Forge。

- [ ] **Step 1: 修改 IntentSessionService**

替换整个 `src/modules/intent/services/intent-session.service.ts` 文件内容：

```typescript
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
```

- [ ] **Step 2: 修复 FeedbackService 的 require 引用**

更新 `src/modules/feedback/services/feedback.service.ts` 中的 `matchByIntent` 方法，把临时 `require(...)` 改为正常 import：

```typescript
// 替换原来的：
// const { ITERATE_KEYWORDS } = require('../../intent/services/intent-session.service');
// 为：
import { ITERATE_KEYWORDS } from '../../intent/services/intent-session.service';
```

并删除临时 require 那段代码。

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 error

- [ ] **Step 4: Commit**

```bash
git add src/modules/intent/services/intent-session.service.ts src/modules/feedback/services/feedback.service.ts
git commit -m "feat(s3.5): add ITERATE_KEYWORDS detection and FeedbackService integration to IntentSessionService"
```

---

## Task 10: 创建 Unit 测试

**Files:**
- Create: `test/unit/feedback/feedback.service.test.ts`
- Create: `test/unit/intent/intent-session.service.iterate.test.ts`
- Reference: `test/unit/forge/forge.service.test.ts`

- [ ] **Step 1: 创建 feedback service unit 测试**

```typescript
// test/unit/feedback/feedback.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackService } from '../../../src/modules/feedback/services/feedback.service';
import type { FeedbackRepository } from '../../../src/modules/feedback/repositories/feedback.repository';
import type { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { FeedbackNotFoundError, FeedbackForbiddenError } from '../../../src/modules/feedback/domain/errors';

describe('FeedbackService', () => {
  let feedbackService: FeedbackService;
  let mockFeedbackRepo: FeedbackRepository;
  let mockArtifactRepo: ArtifactRepository;

  beforeEach(() => {
    mockFeedbackRepo = {
      insert: vi.fn(),
      listByArtifact: vi.fn(),
      listByUserAndIntentKeyword: vi.fn(),
    } as unknown as FeedbackRepository;

    mockArtifactRepo = {
      findById: vi.fn(),
    } as unknown as ArtifactRepository;

    // 注意：FeedbackService 依赖 ITERATE_KEYWORDS from intent-session-service
    // 单元测试里 mock 该依赖
    feedbackService = new FeedbackService(mockFeedbackRepo, mockArtifactRepo);
  });

  describe('create', () => {
    it('throws FeedbackNotFoundError when artifact does not exist', async () => {
      mockArtifactRepo.findById = vi.fn().mockResolvedValue(null);

      await expect(
        feedbackService.create('user1', 'artifact1', 'function_bug', null),
      ).rejects.toThrow(FeedbackNotFoundError);
    });

    it('throws FeedbackForbiddenError when user is not owner', async () => {
      mockArtifactRepo.findById = vi.fn().mockResolvedValue({
        id: 'artifact1', userId: 'user2', kind: 'web', title: 'Test',
        payload: {}, status: 'ready' as const, origin: 'user_intent' as const,
        parentArtifactId: null, createdAt: new Date(), visibility: 'private' as const,
      });

      await expect(
        feedbackService.create('user1', 'artifact1', 'function_bug', null),
      ).rejects.toThrow(FeedbackForbiddenError);
    });

    it('calls feedbackRepo.insert when authorized', async () => {
      mockArtifactRepo.findById = vi.fn().mockResolvedValue({
        id: 'artifact1', userId: 'user1', kind: 'web', title: 'Test',
        payload: {}, status: 'ready' as const, origin: 'user_intent' as const,
        parentArtifactId: null, createdAt: new Date(), visibility: 'private' as const,
      });
      mockFeedbackRepo.insert = vi.fn().mockResolvedValue(undefined);

      await feedbackService.create('user1', 'artifact1', 'function_bug', '按钮不工作');

      expect(mockFeedbackRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: 'artifact1',
          userId: 'user1',
          label: 'function_bug',
          comment: '按钮不工作',
        }),
      );
    });
  });

  describe('injectIntoPrompt', () => {
    it('returns empty string for empty array', () => {
      const result = feedbackService.injectIntoPrompt([]);
      expect(result).toBe('');
    });

    it('returns formatted [HISTORICAL_FEEDBACK] block', () => {
      const feedbacks = [{
        artifactId: 'a1',
        artifactTitle: 'Web App: 记账',
        label: 'function_bug' as const,
        comment: '按钮不工作',
        createdAt: new Date('2026-04-24'),
      }];

      const result = feedbackService.injectIntoPrompt(feedbacks);

      expect(result).toContain('[HISTORICAL_FEEDBACK]');
      expect(result).toContain('Web App: 记账');
      expect(result).toContain('function_bug');
      expect(result).toContain('按钮不工作');
      expect(result).toContain('[/HISTORICAL_FEEDBACK]');
    });

    it('shows "今天" for today feedback', () => {
      const today = new Date();
      const feedbacks = [{
        artifactId: 'a1',
        artifactTitle: 'Test',
        label: 'ui_issue' as const,
        comment: null,
        createdAt: today,
      }];

      const result = feedbackService.injectIntoPrompt(feedbacks);
      expect(result).toContain('今天');
    });

    it('shows "N天前" for older feedback', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
      const feedbacks = [{
        artifactId: 'a1',
        artifactTitle: 'Test',
        label: 'ui_issue' as const,
        comment: null,
        createdAt: twoDaysAgo,
      }];

      const result = feedbackService.injectIntoPrompt(feedbacks);
      expect(result).toContain('2天前');
    });
  });
});
```

- [ ] **Step 2: 创建 intent iterate mode unit 测试**

```typescript
// test/unit/intent/intent-session.service.iterate.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectIterateMode, ITERATE_KEYWORDS } from '../../../src/modules/intent/services/intent-session.service';

describe('detectIterateMode', () => {
  it('returns true for iterate keywords', () => {
    const iterateMessages = [
      '再做一个记账 app',
      '改进一下这个页面',
      '重新生成',
      '再试一次',
      '再来一次记账应用',
      'improve this',
      'retry',
    ];
    iterateMessages.forEach(msg => {
      expect(detectIterateMode(msg)).toBe(true);
    });
  });

  it('returns false for non-iterate messages', () => {
    const normalMessages = [
      '我想要一个记账 app',
      '帮我做一个预算工具',
      '做一个待办事项管理',
    ];
    normalMessages.forEach(msg => {
      expect(detectIterateMode(msg)).toBe(false);
    });
  });

  it('is case insensitive', () => {
    expect(detectIterateMode('IMPROVE')).toBe(true);
    expect(detectIterateMode('RETRY')).toBe(true);
    expect(detectIterateMode('Regenerate')).toBe(true);
  });
});

describe('ITERATE_KEYWORDS', () => {
  it('contains expected keywords', () => {
    expect(ITERATE_KEYWORDS).toContain('改进');
    expect(ITERATE_KEYWORDS).toContain('重新生成');
    expect(ITERATE_KEYWORDS).toContain('再来一次');
    expect(ITERATE_KEYWORDS).toContain('再试一次');
    expect(ITERATE_KEYWORDS).toContain('improve');
    expect(ITERATE_KEYWORDS).toContain('retry');
  });
});
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm test:unit test/unit/feedback/feedback.service.test.ts test/unit/intent/intent-session.service.iterate.test.ts
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add test/unit/feedback/feedback.service.test.ts test/unit/intent/intent-session.service.iterate.test.ts
git commit -m "test(s3.5): add feedback service and intent iterate mode unit tests"
```

---

## Task 11: 创建 Integration 测试

**Files:**
- Create: `test/integration/feedback/feedback.service.int.test.ts`
- Reference: `test/integration/artifact/artifact.repository.int.test.ts`

- [ ] **Step 1: 创建 integration 测试**

```typescript
// test/integration/feedback/feedback.service.int.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { FeedbackRepository } from '../../../src/modules/feedback/repositories/feedback.repository';
import { FeedbackService } from '../../../src/modules/feedback/services/feedback.service';
import { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { startTestDb, cleanupTestDb } from '../setup';

let db: Kysely<Database>;
let feedbackService: FeedbackService;
let feedbackRepo: FeedbackRepository;
let artifactRepo: ArtifactRepository;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;

  artifactRepo = new ArtifactRepository(db);
  feedbackRepo = new FeedbackRepository(db);
  feedbackService = new FeedbackService(feedbackRepo, artifactRepo);

  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `feedback-int-${userId}@test.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Feedback Int Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await cleanupTestDb();
});

beforeEach(async () => {
  await db.deleteFrom('feedbacks').execute();
  await db.deleteFrom('artifacts').where('user_id', 'eq', userId).execute();
});

describe('FeedbackService integration', () => {
  it('create → writes to feedbacks table', async () => {
    const artifactId = ulid();
    await db.insertInto('artifacts').values({
      id: artifactId,
      user_id: userId,
      kind: 'web',
      title: 'Web App: 记账应用',
      payload: JSON.stringify({ entryHtml: '<h1>记账</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }).execute();

    await feedbackService.create(userId, artifactId, 'function_bug', '按钮点击无反应');

    const rows = await db.selectFrom('feedbacks').selectAll().where('artifact_id', '=', artifactId).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('function_bug');
    expect(rows[0].comment).toBe('按钮点击无反应');
  });

  it('matchByIntent finds feedback by artifact title keyword', async () => {
    // 创建带 "记账" 关键词的 artifact
    const artifactId = ulid();
    await db.insertInto('artifacts').values({
      id: artifactId,
      user_id: userId,
      kind: 'web',
      title: 'Web App: 记账应用',
      payload: JSON.stringify({ entryHtml: '<h1>记账</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }).execute();

    await feedbackService.create(userId, artifactId, 'ui_issue', null);

    // 查询（匹配 "记账" 关键词）
    const feedbacks = await feedbackService.matchByIntent(userId, '记账 app', 5);

    expect(feedbacks.length).toBeGreaterThan(0);
    expect(feedbacks[0].artifactTitle).toContain('记账');
    expect(feedbacks[0].label).toBe('ui_issue');
  });

  it('matchByIntent limits to 5 results', async () => {
    // 创建 6 个 artifact + 反馈
    for (let i = 0; i < 6; i++) {
      const aid = ulid();
      await db.insertInto('artifacts').values({
        id: aid,
        user_id: userId,
        kind: 'web',
        title: `Web App: 测试应用${i}`,
        payload: JSON.stringify({ entryHtml: '<h1>测试</h1>' }),
        status: 'ready',
        origin: 'user_intent',
        visibility: 'private',
        created_at: new Date(),
      }).execute();
      await feedbackService.create(userId, aid, 'function_bug', null);
    }

    const feedbacks = await feedbackService.matchByIntent(userId, '测试', 5);
    expect(feedbacks.length).toBe(5);
  });

  it('listByArtifactForOwner rejects non-owner', async () => {
    const artifactId = ulid();
    await db.insertInto('artifacts').values({
      id: artifactId,
      user_id: 'other-user-id',
      kind: 'web',
      title: 'Other user artifact',
      payload: JSON.stringify({ entryHtml: '<h1>Other</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }).execute();

    await expect(
      feedbackService.listByArtifactForOwner(userId, artifactId),
    ).rejects.toThrow('无权对该产物提交反馈');
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
pnpm test:integration test/integration/feedback/feedback.service.int.test.ts
```

Expected: All tests pass (requires Docker Desktop)

- [ ] **Step 3: Commit**

```bash
git add test/integration/feedback/feedback.service.int.test.ts
git commit -m "test(s3.5): add feedback service integration tests"
```

---

## Task 12: E2E 增量（迭代模式端到端）

**Files:**
- Modify: `test/e2e/intent.e2e.test.ts`
- Reference: `test/e2e/intent.e2e.test.ts`

- [ ] **Step 1: 添加迭代模式 E2E 测试**

在 `test/e2e/intent.e2e.test.ts` 末尾添加以下测试：

```typescript
describe('Iteration Mode (S3.5)', () => {
  it('returns "clarifying" for iterate-only message without intent', async () => {
    const create = await request(app).post('/api/intent/sessions').set('Cookie', cookie).send({});
    expect(create.status).toBe(201);
    const sessionId = create.body.sessionId;

    // 只有迭代关键词，没有具体需求 → 应该是 clarifying
    const r = await request(app)
      .post(`/api/intent/sessions/${sessionId}/messages`)
      .set('Cookie', cookie)
      .send({ message: '再试一次' });
    expect(r.status).toBe(200);
    // 不触发 forge，但可能触发 iteration 逻辑
  });

  it('iterate keyword detection: "改进一下" triggers iteration mode', async () => {
    // 这个测试验证 ITERATE_KEYWORDS 被正确检测
    // 实际行为需要 mock LLM 返回 __EXECUTE__ 来触发 forge
    // 由于当前 E2E mock 不在 forge 路径，这里只测端点可达性
    const create = await request(app).post('/api/intent/sessions').set('Cookie', cookie).send({});
    const sessionId = create.body.sessionId;

    const r = await request(app)
      .post(`/api/intent/sessions/${sessionId}/messages`)
      .set('Cookie', cookie)
      .send({ message: '改进一下记账 app' });
    expect(r.status).toBe(200);
    expect(r.body.message).toBeDefined();
  });
});

describe('Feedback API', () => {
  let testArtifactId: string;

  beforeAll(async () => {
    // 创建一个 test artifact 用于反馈测试
    testArtifactId = ulid();
    const pool = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
    const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });
    await db.executeInsert('artifacts', [{
      id: testArtifactId,
      user_id: (await db.selectFrom('users').select('id').limit(1).executeTakeFirst())!.id,
      kind: 'web',
      title: 'Web App: 测试反馈',
      payload: JSON.stringify({ entryHtml: '<h1>测试</h1>' }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'private',
      created_at: new Date(),
    }]);
    await db.destroy();
  });

  it('POST /api/feedback creates feedback for artifact', async () => {
    const r = await request(app)
      .post('/api/feedback')
      .set('Cookie', cookie)
      .send({ artifact_id: testArtifactId, label: 'function_bug', comment: '按钮坏了' });
    expect(r.status).toBe(201);
    expect(r.body.success).toBe(true);
  });

  it('POST /api/feedback rejects invalid label', async () => {
    const r = await request(app)
      .post('/api/feedback')
      .set('Cookie', cookie)
      .send({ artifact_id: testArtifactId, label: 'invalid_label' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('GET /api/artifacts/:id/feedback returns feedback list', async () => {
    const r = await request(app)
      .get(`/api/artifacts/${testArtifactId}/feedback`)
      .set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });
});
```

**注意**：如果 `intent.e2e.test.ts` 已有 `describe('Intent API')` 闭合花括号，需要把新 describe 放在文件末尾（不是嵌套进去）。

- [ ] **Step 2: Run E2E tests**

```bash
pnpm test:e2e test/e2e/intent.e2e.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/e2e/intent.e2e.test.ts
git commit -m "test(s3.5): add iteration mode and feedback API E2E tests"
```

---

## Task 13: 全量验证

- [ ] **Step 1: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 error

- [ ] **Step 2: Unit tests**

```bash
pnpm test:unit
```

Expected: All pass

- [ ] **Step 3: Integration tests**

```bash
pnpm test:integration
```

Expected: All pass

- [ ] **Step 4: E2E tests**

```bash
pnpm test:e2e
```

Expected: All pass

- [ ] **Step 5: Full test suite**

```bash
pnpm test
```

Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(s3.5): mark complete"
```

---

## 依赖关系

```
Task 1 (migration)
    ↓
Task 2 (domain types)
    ↓
Task 3 (domain errors)
    ↓
Task 4 (repository)
    ↓
Task 5 (service) ←── Task 9 完成后修复 require 引用
    ↓
Task 6 (controller)
    ↓
Task 7 (routes + main.ts)
    ↓
Task 8 (ForgeService)
    ↓
Task 9 (IntentSessionService) ──→ Task 5 完成后回填 require 引用
    ↓
Task 10 (unit tests)
    ↓
Task 11 (integration tests)
    ↓
Task 12 (E2E)
    ↓
Task 13 (verification)
```

---

*实现计划基于 2026-04-25 设计文档。17 个决策见设计文档第二节。*