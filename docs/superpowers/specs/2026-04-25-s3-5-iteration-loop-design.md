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
    const rows = await this.feedbackRepo.listByArtifact(artifactId);
    return rows.map(r => ({
      artifactId: r.artifact_id,
      artifactTitle: '',  // 需要 artifact.title，这里简化处理
      label: r.label as FeedbackLabel,
      comment: r.comment,
      createdAt: r.created_at,
    }));
  }

  async matchByIntent(userId: string, description: string, limit = 5): Promise<HistoricalFeedback[]> {
    // 提取关键词：从 description 中取名词/动词（简单策略：取前10个字符）
    const keyword = description.substring(0, 10);

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

### IntentSessionService 改动（迭代模式检测）

```typescript
// src/modules/intent/services/intent-session.service.ts（增量）

export type IntentMode = 'capture' | 'iterate';

const ITERATE_KEYWORDS = [
  '改进', '重新生成', '再来一次', '再试一次',
  '改一下', '重新做一个', '重新来', '再做一个',
  'improve', 'retry', 'regenerate', 'again',
];

function detectIterateMode(message: string): boolean {
  return ITERATE_KEYWORDS.some(kw => message.toLowerCase().includes(kw.toLowerCase()));
}

export class IntentSessionService {
  // ... 现有方法不变 ...

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

    // 检测迭代模式
    const mode: IntentMode = detectIterateMode(userMessage) ? 'iterate' : 'capture';

    const historyResult = await this.memory.listMessages(userId, sessionId, { limit: 100 });
    const llmMessages = buildLlmMessages(historyResult.items, INTENT_SYSTEM_PROMPT);

    // 迭代模式：注入历史反馈
    let feedbackContext = '';
    if (mode === 'iterate') {
      // 从 userMessage 提取 description（简化：取用户最新一条的 content 作为 description）
      const feedbackService = this.feedbackService; // 需要注入
      const feedbacks = await feedbackService.matchByIntent(userId, userMessage, 5);
      feedbackContext = feedbackService.injectIntoPrompt(feedbacks);
    }

    const response = await this.llm.complete(llmMessages, feedbackContext);
    // ...
  }
}
```

### ForgeService 改动（feedbackContext + origin='iteration'）

```typescript
// src/modules/forge/services/forge.service.ts（改动部分）

export class ForgeService {
  async triggerFromIntent(
    userId: string,
    sessionId: string,
    input: { description: string; form: 'web' },
    feedbackContext?: string,  // 新增可选参数
  ): Promise<void> {
    const { description } = input;

    // 构建 prompt（含反馈上下文）
    const baseMessages = buildWebPrompt(description);
    if (feedbackContext) {
      // 在 system prompt 前插入反馈块
      baseMessages[0] = {
        role: 'system',
        content: feedbackContext + baseMessages[0].content,
      };
    }

    const response = await this.llm.complete(baseMessages);
    // ... 解析 + 存 artifact ...
    const origin = feedbackContext ? 'iteration' : 'user_intent';
    const parentArtifactId = feedbackContext ? /* 需要传 parentArtifactId */ : null;
    // ...
  }
}
```

### FeedbackController（路由）

```typescript
// src/modules/feedback/controllers/feedback.controller.ts

import type { Request, Response, NextFunction } from 'express';
import type { FeedbackService } from '../services/feedback.service';
import type { FeedbackLabel } from '../domain/feedback';
import { FEEDBACK_LABELS } from '../domain/feedback';
import { ValidationError } from '../../../core/errors';

export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });

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
      const { id } = req.params;
      const feedbacks = await this.feedbackService.listByArtifact(id);
      res.json({ items: feedbacks });
    } catch (e) {
      next(e);
    }
  }
}
```

### FeedbackRoutes

```typescript
// src/modules/feedback/routes/feedback.routes.ts

import type { Router } from 'express';
import type { FeedbackService } from '../services/feedback.service';
import type { SessionService } from '../../identity/services/session.service';
import { FeedbackController } from '../controllers/feedback.controller';
import { requireSession } from '../../../core/middleware/require-session';

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

1. **注入 FeedbackService**：constructor 增加第三个参数 `feedbackService: FeedbackService`
2. **迭代关键词检测**：在 `sendMessage` 入口新增 `detectIterateMode(userMessage)`
3. **反馈注入**：迭代模式下调 `feedbackService.matchByIntent(userId, userMessage, 5)`
4. **Prompt 传递**：把 `feedbackContext` 传入 `llm.complete`（需要修改 `LlmClient.complete` 签名支持附加 context）
5. **Forge 调用**：把 `feedbackContext` 透传给 `forge.triggerFromIntent`

### LlmClient 接口扩展

```typescript
// src/modules/llm/client.ts（增量）

export interface LlmClient {
  complete(messages: LlmMessage[], contextHint?: string): Promise<LlmResponse>;
  // 新增 contextHint：可选的系统级上下文注入（如反馈块）
}
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
2. `feedback/domain/feedback.ts`（类型 + FEEDBACK_LABELS）
3. `feedback/repositories/feedback.repository.ts`（CRUD + matchByIntent SQL）
4. `feedback/services/feedback.service.ts`（create + matchByIntent + injectIntoPrompt）
5. `feedback/controllers/feedback.controller.ts`（create + listByArtifact）
6. `feedback/routes/feedback.routes.ts` + `main.ts` 注册
7. `IntentSessionService` 改动（迭代检测 + 注入 FeedbackService）
8. `ForgeService` 改动（feedbackContext 参数 + origin='iteration'）
9. `LlmClient.complete` 签名扩展（contextHint 参数）
10. Unit 测试（feedback service + intent iterate mode）
11. Integration 测试（完整反馈循环）
12. E2E 增量（迭代模式端到端）
13. Typecheck + 全量测试绿

---

*本设计基于 2026-04-25 brainstorming 对话生成。14 个决策见第二节。*