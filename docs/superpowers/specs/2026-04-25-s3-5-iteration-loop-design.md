# S3.5 · 迭代循环(Iteration Loop)设计

> **范围**: moon-agent-os 平台 L3 层 Forge & Runtime 的 S3.5 迭代循环子系统。Vision 文档里程碑 M3 的一部分。
>
> **定位**: 实现「按日进化」的核心机器——收集产物运行反馈 → 写回记忆系统 → 影响下一次生成，闭合 Forge Pipeline 的质量提升回路。

**生成日期**: 2026-04-25
**依赖**: S3.1 意图捕获 / S3.2 产物模型 / S3.3 生成流水线 / S2.1 记忆存储（全部已完成）
**并行**: M3 其他子系统
**参考**: `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`

---

## 一、目标与边界

### S3.5 要交付什么

把「反馈 → 记忆 → 生成」这条质量提升回路跑通。

**核心流程**:
```
用户使用 artifact
        │
        ▼
  弹出反馈浮层（生成后立即）
        │
        ▼
  POST /api/feedback  →  feedbacks 表
        │
        ▼
  用户说"再改进一下"（迭代关键词检测）
        │
        ▼
  查询历史反馈（按意图相似匹配）
        │
        ▼
  注入 Forge prompt（结构化反馈块）
        │
        ▼
  新 artifact 生成（origin='iteration', parent_artifact_id）
```

**必须具备**:
- `POST /api/feedback`：反馈收集端点，owner 校验，label 枚举校验
- `GET /api/artifacts/:id/feedback`：查询指定 artifact 的反馈列表
- `FeedbackService.matchByIntent(description)`：按意图字符串匹配历史反馈
- `FeedbackService.injectIntoPrompt(feedbacks)`：生成结构化反馈块
- `IntentSessionService` 迭代模式检测（关键词：改进/重新生成/再来一次/再试一次）
- `ForgeService` 支持反馈上下文注入，支持 `origin='iteration'`
- 迭代生成的新 artifact 携带 `parent_artifact_id`（血缘可追溯）

**明确不做**（留给未来）:
- ❌ 隐式行为收集（点击/停留/放弃等埋点，M3 后引入）
- ❌ 自动相似性检测（M3 只有显式关键词触发，M4 才引入相似度判断）
- ❌ 跨用户反馈聚合（M3 只有 owner 对自己产物评价，M4 S5.x 发现层再做）
- ❌ 反馈趋势分析/平台平均对比（M3 数据量少，统计无意义）
- ❌ 标签体系扩展的 review 流程（M3 先跑通封闭集）

---

## 二、关键决策

| # | 维度 | 决策 | 理由 |
|---|---|---|---|
| 1 | 反馈类型 | 混合模式（先显式后隐式） | M3 冷启动阶段显式为主；隐式埋点留 M3 后 |
| 2 | 反馈存储 | 独立 Feedback 表 | 独立表支持跨 artifact 聚合查询；与 artifact 分离设计更清晰 |
| 3 | 评价维度 | 结构化分类标签 | 点选而非填写，摩擦小；结构化数据易查询聚合 |
| 4 | 反馈触发 | 生成完成后立即提示 | 用户刚看到产物，印象新鲜；快速收集冷启动数据 |
| 5 | 迭代触发 | 手动触发（关键词） | M3 最可靠；自动相似性检测依赖 S2.3 能力，M4 才引入 |
| 6 | 反馈与记忆连接 | 独立 feedback context，Forge prompt 注入 | 与普通消息隔离；Forge 清晰看到反馈信号 |
| 7 | 历史反馈查询 | 意图字符串相似匹配 | M3 最简单；artifact.title 是 `Web App: {description}`，字面匹配足够 |
| 8 | 反馈聚合 | 平铺列表（时间倒序） | M3 阶段匹配artifact 数量不会多；等反馈量上来再引入聚合层 |
| 9 | 反馈标签体系 | 封闭集 + 扩展机制 | M3 有锚点；「其他」类别分析是扩展入口 |
| 10 | 迭代意图识别 | 显式模式切换（关键词检测） | S3.1 新增 mode 字段（capture/iterate）；自然语言表达，用户零学习成本 |
| 11 | 反馈收集 UI | 独立 `/api/feedback` 端点 | 与生成流程解耦；前端设计专门 UI；数据干净 |
| 12 | 迭代 artifact 处理 | 新建 + `parent_artifact_id` 血缘 | artifact 不可变；历史完整可追溯；血缘清晰 |
| 13 | 反馈权限范围 | 仅 owner，一对多 | M3「自己评价自己产物→影响自己下次生成」回路完整；跨用户反馈留 M4 |
| 14 | prompt 注入 | 结构化块 + system prompt + 上限 5 条 | 与 S3.3 现有 prompt 架构一致；上限防止膨胀；结构化便于未来扩展 |
| 15 | parent_artifact_id 来源 | matchByIntent 结果中最新的那个 artifact | 与 Q5/Q10 的零前端改动理念一致；自动选取最近相似产物作为血缘起点 |
| 16 | 关键词提取 | 剥离 ITERATE_KEYWORDS 后取前 10 字符 | 去除迭代词噪音后中文前 10 字符信息密度足够；M4 引入 S2.3 再升级 |
| 17 | artifactTitle 来源 | Service 层调 artifactRepo.findById 填充 | 主键查询性能足够；比 JOIN 更清晰；前端反馈详情页天然需要 title |

---

## 三、架构

### 数据流

```
用户使用 artifact（GET /app/:id）
        │
        ▼
  前端弹出反馈浮层
  (固定标签：function_bug / ui_issue / slow_performance / missing_feature / other)
        │
        ▼
  POST /api/feedback
  { artifact_id, label, comment? }
        │
        ▼
  FeedbackService.create(userId, artifactId, label, comment)
        │
        ▼
  feedbacks 表写入（owner 校验 + label 枚举校验）
        │
        ▼
  用户说"再改进一下" / "重新生成"
        │
        ▼
  IntentSessionService 检测迭代关键词
  → mode 切换为 'iterate'
  → 调用 FeedbackService.matchByIntent(userId, description)
        │
        ▼
  matchByIntent: 查 feedbacks 表
  WHERE artifact.user_id = userId
  AND artifact.title LIKE '%{description关键词}%'
  ORDER BY created_at DESC LIMIT 5
        │
        ▼
  返回 HistoricalFeedback[]
        │
        ▼
  注入 Forge prompt（buildWebPrompt + injectFeedbackContext）
        │
        ▼
  ForgeService 携带 feedbackContext 生成
  → origin='iteration', parent_artifact_id=原artifact.id
        │
        ▼
  新 artifact 写入 + 记忆写回
```

### 目录结构

```
src/modules/
├── feedback/
│   ├── domain/
│   │   └── feedback.ts                    # Feedback 类型 + Label 常量
│   ├── repositories/
│   │   └── feedback.repository.ts          # feedbacks 表 CRUD
│   ├── services/
│   │   └── feedback.service.ts            # matchByIntent + injectIntoPrompt
│   ├── controllers/
│   │   └── feedback.controller.ts         # POST /api/feedback + GET /api/artifacts/:id/feedback
│   └── routes/
│       └── feedback.routes.ts             # 注册路由
├── intent/
│   └── services/
│       └── intent-session.service.ts      # 改动：迭代模式检测 + mode 字段
├── forge/
│   ├── services/
│   │   └── forge.service.ts               # 改动：feedbackContext 参数 + origin='iteration'
│   └── generators/
│       └── web.generator.ts               # 改动：injectFeedbackContext
└── main.ts                                 # 改动：注册 feedback 路由

migrations/
└── 20260425_005_add_feedbacks_table.ts    # 新增
```

### 依赖关系

```
FeedbackService 依赖:
  - ArtifactRepository (查 artifact.userId 校验 owner)
  - Kysely DB

FeedbackController 依赖:
  - FeedbackService
  - SessionService (getUserId)

IntentSessionService 改动:
  - 需要 new parameter: FeedbackService (用于迭代模式查历史反馈)

ForgeService 改动:
  - triggerFromIntent 增加可选 feedbackContext 参数
  - 调用 buildWebPrompt 时传入
```

---

## 四、核心代码

### Migration: 添加 feedbacks 表

```typescript
// migrations/20260425_005_add_feedback_table.ts

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. 创建 feedbacks 表
  await sql`
    CREATE TABLE feedbacks (
      id          CHAR(26)      NOT NULL,
      artifact_id CHAR(26)      NOT NULL,
      user_id     CHAR(26)      NOT NULL,
      label       VARCHAR(32)   NOT NULL,
      comment     TEXT          NULL,
      created_at  DATETIME(3)    NOT NULL,
      PRIMARY KEY (id),
      KEY idx_feedbacks_artifact (artifact_id),
      KEY idx_feedbacks_user_created (user_id, created_at DESC),
      KEY idx_feedbacks_label (label),
      CONSTRAINT chk_feedbacks_label
        CHECK (label IN ('function_bug', 'ui_issue', 'slow_performance', 'missing_feature', 'other')),
      CONSTRAINT fk_feedbacks_artifact FOREIGN KEY (artifact_id)
        REFERENCES artifacts(id) ON DELETE CASCADE,
      CONSTRAINT fk_feedbacks_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS feedbacks`.execute(db);
}
```

### Domain 类型

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

### FeedbackRepository

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
    // 查询用户所有 artifact 的反馈，按 intent 关键词匹配 artifact.title
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

    return rows.map(r => ({ ...r, artifact_title: titleMap.get(r.artifact_id) ?? '' }));
  }
}
```

### FeedbackService

```typescript
// src/modules/feedback/services/feedback.service.ts

import { ulid } from 'ulid';
import type { FeedbackRepository } from '../repositories/feedback.repository';
import type { ArtifactRepository } from '../../artifact/repositories/artifact.repository';
import type { HistoricalFeedback, FeedbackLabel } from '../domain/feedback';
import { ITERATE_KEYWORDS } from '../../intent/services/intent-session.service';
import { FeedbackNotFoundError, FeedbackForbiddenError } from '../domain/errors';

/**
 * 剥离迭代关键词（Q16）。
 * 例："再做一个记账 app" → "记账 app"。
 */
function stripIterateKeywords(text: string): string {
  let out = text;
  for (const kw of ITERATE_KEYWORDS) {
    out = out.replace(new RegExp(kw, 'gi'), '');
  }
  return out.trim();
}

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
    // 同时查 artifact title（决策 Q17：Service 层主键查询填充）
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

  async matchByIntent(userId: string, description: string, limit = 5): Promise<HistoricalFeedback[]> {
    // 决策 Q16：剥离迭代关键词后取前 10 字符
    const stripped = stripIterateKeywords(description);
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

  /**
   * 查找迭代生成时的 parent_artifact_id（决策 Q15）。
   * 返回 matchByIntent 结果中最新的 artifact id；无匹配返回 null。
   */
  async findParentArtifactId(userId: string, description: string): Promise<string | null> {
    const feedbacks = await this.matchByIntent(userId, description, 1);
    return feedbacks[0]?.artifactId ?? null;
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

### IntentSessionService 改动（迭代模式检测）

**要点**：反馈**不注入意图捕获阶段的 LLM**（clarifying 用的是 INTENT_SYSTEM_PROMPT），只在 `forge.triggerFromIntent` 阶段注入。意图捕获阶段只需要：
1. 检测到迭代关键词 → 将 `feedbackContext + parentArtifactId` 透传给 Forge
2. 不修改 INTENT_SYSTEM_PROMPT；不修改 LlmClient.complete 签名

```typescript
// src/modules/intent/services/intent-session.service.ts（增量）

export type IntentMode = 'capture' | 'iterate';

export const ITERATE_KEYWORDS = [
  '改进', '重新生成', '再来一次', '再试一次',
  '改一下', '重新做一个', '重新来', '再做一个',
  'improve', 'retry', 'regenerate', 'again',
];

export function detectIterateMode(message: string): boolean {
  return ITERATE_KEYWORDS.some(kw => message.toLowerCase().includes(kw.toLowerCase()));
}

export class IntentSessionService {
  constructor(
    private readonly memory: MemoryService,
    private readonly llm: LlmClient,
    private readonly forge: ForgeService,
    private readonly feedbackService: FeedbackService,  // 新增依赖
  ) {}

  async sendMessage(
    userId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<SendMessageResult> {
    await this.memory.getConversation(userId, sessionId);

    await this.memory.addMessage(userId, sessionId, {
      role: 'user',
      content: userMessage,
    });

    const historyResult = await this.memory.listMessages(userId, sessionId, { limit: 100 });
    const llmMessages = buildLlmMessages(historyResult.items, INTENT_SYSTEM_PROMPT);

    // intent LLM 照常调用（不注入反馈，反馈只影响 Forge 生成阶段）
    const response = await this.llm.complete(llmMessages);
    const { isExecutable, responseText, intentDescription } = parseLlmOutput(response.content);

    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: responseText,
    });

    if (isExecutable) {
      const description = intentDescription ?? userMessage;
      // 决策 Q10：检测迭代关键词（在用户原始消息上判断）
      const isIterate = detectIterateMode(userMessage);

      let feedbackContext = '';
      let parentArtifactId: string | null = null;
      if (isIterate) {
        // 决策 Q7/Q8/Q14：查历史反馈（上限 5 条）
        const feedbacks = await this.feedbackService.matchByIntent(userId, description, 5);
        feedbackContext = this.feedbackService.injectIntoPrompt(feedbacks);
        // 决策 Q15：parent = matchByIntent 结果中最新的那个
        parentArtifactId = feedbacks[0]?.artifactId ?? null;
      }

      await this.forge.triggerFromIntent(userId, sessionId, {
        description,
        form: 'web',
      }, { feedbackContext, parentArtifactId });

      return {
        message: responseText,
        status: 'triggered',
        intent: { description, form: 'web' },
      };
    }
    return { message: responseText, status: 'clarifying', intent: null };
  }
}
```

### ForgeService 改动（feedbackContext + origin='iteration'）

```typescript
// src/modules/forge/services/forge.service.ts（改动部分）

export type ForgeIterationContext = {
  feedbackContext: string;         // 已格式化的 [HISTORICAL_FEEDBACK]...[/HISTORICAL_FEEDBACK] 块；无反馈时为空字符串
  parentArtifactId: string | null; // 迭代 artifact 的 parent；无匹配时为 null
};

export class ForgeService {
  async triggerFromIntent(
    userId: string,
    sessionId: string,
    input: { description: string; form: 'web' },
    iteration?: ForgeIterationContext,  // 新增可选参数（非迭代调用时不传）
  ): Promise<void> {
    const { description } = input;
    const hasFeedback = iteration && iteration.feedbackContext.length > 0;

    // 1. 构建 prompt（迭代时在 system prompt 前拼反馈块）
    const baseMessages = buildWebPrompt(description);
    if (hasFeedback) {
      baseMessages[0] = {
        role: 'system',
        content: iteration!.feedbackContext + baseMessages[0].content,
      };
    }

    // 2. LLM 调用（签名不变，不改 LlmClient）
    const response = await this.llm.complete(baseMessages);

    // 3. 解析响应
    let parsed: { entryHtml: string; assets: Record<string, string> };
    try {
      parsed = parseWebResponse(response.content);
    } catch {
      throw new ForgeGenerationError('LLM 响应格式错误，无法解析为 JSON');
    }

    // 4. 存 artifact（决策 Q12：迭代 artifact origin='iteration' + parent_artifact_id）
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

    // 5. 写回记忆
    await this.memory.addMessage(userId, sessionId, {
      role: 'system',
      content: `产物已生成：${artifact.title}，ID: ${artifact.id}`,
    });
  }
}
```

**注意**：`ArtifactService.create()` 的 `CreateArtifactInput` 已有 `parentArtifactId?: string | null` 字段（S3.2 建的），**不需要改 ArtifactService**。

### FeedbackController（路由）

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
      // 项目规范：userId 从 res.locals.auth（由 requireSession 中间件注入）读取
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
      // 权限：仅 owner 可查（通过 feedbackService 内部校验，见 S3.5 Q13）
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

**注意**：
- `listByArtifactForOwner` 是 `FeedbackService` 上的新方法，内部先校验 `artifact.userId === userId`，非 owner 抛 `FeedbackForbiddenError`；spec 第四节 FeedbackService 示例中的 `listByArtifact` 在实际实现时替换为该方法（与 Q13 决策保持一致）。
- `errorHandler` 会把 `FeedbackForbiddenError` 映射为 HTTP 403。

### FeedbackRoutes

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

  // POST /api/feedback - 创建反馈（需登录）
  router.post('/api/feedback', auth, (req, res, next) => controller.create(req, res, next));

  // GET /api/artifacts/:id/feedback - 查询 artifact 的反馈（需登录）
  router.get('/api/artifacts/:id/feedback', auth, (req, res, next) => controller.listByArtifact(req, res, next));
}
```

---

## 五、S3.1 适配

### IntentSessionService 改造要点

1. **注入 FeedbackService**：constructor 增加第四个参数 `feedbackService: FeedbackService`
2. **迭代关键词检测**：在 `sendMessage` 的 `isExecutable` 分支中调用 `detectIterateMode(userMessage)`
3. **反馈查询 + parent 选取**：迭代模式下一并调 `feedbackService.matchByIntent(userId, description, 5)`，取 `feedbacks[0].artifactId` 作为 `parentArtifactId`
4. **Forge 调用**：把 `{ feedbackContext, parentArtifactId }` 透传给 `forge.triggerFromIntent` 第四个参数
5. **不改 LlmClient**：反馈只影响 Forge 生成阶段的 system prompt；意图捕获阶段的 LLM 调用完全不变

### main.ts 装配变化

```typescript
// 装配顺序变化
const feedbackRepo = new FeedbackRepository(db);
const feedbackService = new FeedbackService(feedbackRepo, artifactRepo);

// forge 不变
const forgeService = new ForgeService(llmClient, artifactService, memoryService);

// intent 现在依赖 feedbackService
const intentService = new IntentSessionService(
  memoryService, llmClient, forgeService, feedbackService,  // 新增第四个参数
);

// 注册 feedback 路由
registerFeedbackRoutes(expressApp, feedbackService, sessions, cfg.session.cookieName);
```

---

## 六、错误处理

| 场景 | 行为 |
|---|---|
| artifact 不存在 | 400 VALIDATION_FAILED（feedback 创建时） |
| 非 owner 提交反馈 | 403 Forbidden |
| label 不在枚举中 | 400 VALIDATION_FAILED |
| 迭代模式下无历史反馈 | 正常生成，无反馈块注入（降级） |
| artifact.title 无匹配 | 正常生成，无反馈块注入（降级） |
| LLM 生成失败（带反馈上下文） | 抛 ForgeGenerationError，同 S3.3 |

**降级策略**：反馈查询为空时正常生成，不阻塞用户迭代意图。

---

## 七、测试策略

### Unit (`test/unit/feedback/`)

- `feedback.service.test.ts`：
  - `matchByIntent`：模拟 DB 返回匹配 rows，验证 keyword 传入正确
  - `injectIntoPrompt`：空数组返回空字符串；有内容返回 `[HISTORICAL_FEEDBACK]...[/HISTORICAL_FEEDBACK]` 格式；验证时间字符串（今天/N天前）
  - `create`：artifact 不存在抛 NotFoundError；非 owner 抛 ForbiddenError
- `intent-session.service.iterate.test.ts`：
  - 迭代关键词命中时切换 mode
  - 迭代模式下 `feedbackService.matchByIntent` 被调用
  - `detectIterateMode`：覆盖所有关键词 + 非关键词边界

### Integration (`test/integration/feedback/`)

- `feedback.service.int.test.ts`：
  - 创建反馈 → 写入 feedbacks 表
  - `matchByIntent`：创建多个 artifact + 反馈，按关键词匹配正确返回
  - 上限 5 条：超过时只返回最近 5 条

### E2E（扩展 existing intent.e2e.test.ts）

- `test/e2e/intent.e2e.test.ts` 增量：
  - 用户说"改进一下" → 检测迭代模式
  - 用户说"再试一次记账 app" → 历史反馈被注入 prompt
  - `origin='iteration'` artifact 被创建，parent_artifact_id 正确

---

## 八、非功能性约束

| 维度 | 约束 |
|---|---|
| **性能** | 反馈查询走已有 artifact 索引；匹配结果上限 5 条，不膨胀 prompt |
| **安全** | owner 校验防止伪造反馈；label 枚举校验防注入 |
| **可观测** | 迭代生成打 info 日志（带 feedback context 长度） |
| **兼容性** | feedbackContext 参数可选，兼容 S3.3 已有调用（无反馈时透传） |

---

## 九、与未来里程碑的接口

| 里程碑 | 变化 |
|---|---|
| M3 隐式反馈 | S4 层运行器埋点，点击/停留数据写入 feedbacks 表（加 `behavior_type` 字段） |
| M4 相似性检测 | S2.3 理解与索引后，替换字符串匹配为向量相似度搜索 |
| M4 标签扩展 | 平台侧按季度 review「other」标签分布，新增正式标签 |
| M4 S5.x 发现层 | 公开 artifact 的跨用户反馈聚合；画廊页展示平均评分 |
| M4 Artifact 版本管理 | `origin='iteration'` 链可视图；用户可回滚到任意历史版本 |

---

## 十、实现顺序提示（给 writing-plans）

1. `20260425_005_add_feedback_table.ts` migration
2. `feedback/domain/feedback.ts`（类型 + FEEDBACK_LABELS + HistoricalFeedback）
3. `feedback/domain/errors.ts`（FeedbackNotFoundError + FeedbackForbiddenError）
4. `feedback/repositories/feedback.repository.ts`（CRUD + listByUserAndIntentKeyword）
5. `feedback/services/feedback.service.ts`（create + matchByIntent + injectIntoPrompt + listByArtifactForOwner）
6. `feedback/controllers/feedback.controller.ts`（create + listByArtifact）
7. `feedback/routes/feedback.routes.ts`
8. `ForgeService` 改动（ForgeIterationContext 参数 + origin='iteration' + parent_artifact_id）
9. `IntentSessionService` 改动（ITERATE_KEYWORDS 常量导出 + detectIterateMode + 注入 FeedbackService 依赖 + 迭代分支）
10. `main.ts` 装配更新（FeedbackRepository/Service 注入 + IntentSessionService 第四参数 + 注册 feedback 路由）
11. Unit 测试（feedback service + intent iterate mode）
12. Integration 测试（完整反馈循环）
13. E2E 增量（迭代模式端到端）
14. Typecheck + 全量测试绿

---

*本设计基于 2026-04-25 brainstorming 对话生成。17 个决策见第二节。*