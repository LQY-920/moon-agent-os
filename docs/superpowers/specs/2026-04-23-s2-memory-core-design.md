# S2 · 记忆中枢(Memory Core)M1 最小版设计

> **范围**:moon-agent-os 平台 L2 层记忆中枢的 **S2.1 记忆存储 + S2.4 回忆 API** 最小可用版本(Vision 文档里程碑 M1)。
>
> **不包含**:S2.2 采集管道、S2.3 理解与索引、S2.5 记忆治理(这些是 M3 的事)。

**生成日期**: 2026-04-23
**依赖**: S1.1 账户与身份(已完成)
**参考**: `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`

---

## 一、目标与边界

### M1 要交付什么

一个让用户"把对话存进来、按会话拉出来、不要了就删掉"的最小可用记忆系统。只存对话文本。

**必须具备**:
- 对话存储(conversations + messages 双表)
- 归属隔离(数据硬绑定 `user_id`,跨用户 403)
- HTTP API + 内部 Service(双层,都可对接)
- 复用 S1.1 的鉴权(`requireSession`)

**明确不做**(留给未来里程碑):
- ❌ 内容检索 / 向量化(M3 S2.3)
- ❌ 采集管道 / 事件订阅(M3 S2.2)
- ❌ 软删除 / 导出 / 历史回滚(M3 S2.5)
- ❌ 产物快照 / 行为轨迹(M2-M3)
- ❌ 改对话标题、删单条消息(M3 S2.5)
- ❌ 限流(M1 内部用,无恶意来源)

### 语义定位(和 Vision 文档对齐)

- **归属主体唯一 = 用户**。所有记忆数据 FK → `users(id)`,注销随 CASCADE 清空 —— 这是**目标行为**,不是副作用
- **记忆粒度 = 会话 + 消息**。双表,会话是元数据容器,消息是实际内容
- **消费路径双层**:内部同进程用 `MemoryService`,外部 HTTP 走 `/api/memory/*`

---

## 二、关键决策

| # | 维度 | 决策 | 理由 |
|---|---|---|---|
| 1 | 记忆范围 | 只存对话,预留未来扩展(约定级,不建空表) | 避免"空建表提前过时";未来 M3 再建 |
| 2 | 数据粒度 | 双表 `conversations` + `messages` | 单表查会话元数据别扭;分 JSON blob 未来要重构 |
| 3 | 检索机制 | 纯元数据查询(user_id / conversation_id / 时间 / 分页)。**不支持内容搜索** | M1 无消费方,检索模式没摸出来;M3 做才有依据 |
| 4 | API 形态 | Service + HTTP 双层 | 内部调用避开 HTTP 开销;外部/调试走 HTTP;结构和 S1.1 一致 |
| 5 | 写入触发 | HTTP 外部写 + Service 内部调用,**无事件订阅** | 当前 `authEvents` 语义属审计不属记忆;M3 再议 |
| 6 | 用户绑定 | 硬绑定 `user_id`,非 `owner_id + owner_type` | Vision 已锁定"单一归属主体";team 是 YAGNI |
| 7 | 鉴权 | 复用 S1.1 `requireSession` middleware | 已落地、已测;M1 无独立服务调用需求 |
| 8 | 删除策略 | 硬删 + FK CASCADE | 软删陷阱:所有查询要加 `deleted_at IS NULL`,复杂度翻倍 |
| 9 | 会话元数据 | `title` (可空) + `created_at` + `updated_at` | `updated_at` 是列表排序刚需 |
| 10 | 消息结构 | `role` (VARCHAR(16) + CHECK) + `content` (TEXT) | 对齐 OpenAI/Anthropic chat 标准;VARCHAR 便于未来加值 |
| 11 | 预留程度 | 文档约定级预留,不建空表 | 空表会随 M3 演化,预建等于提前过时 |
| 12 | 测试策略 | unit + integration(testcontainers)+ e2e(supertest)三档 | 对齐 S1.1,基础设施零新增 |
| 13 | 文件组织 | `src/modules/memory/` 照搬 S1.1 identity 结构(不带 events.ts) | 心智模型复用 |
| 14 | 端点范围 | 6 个必备(建/列/读/写/读消息/删),不做改标题、不做删单消息 | 严格对齐 M1 范围,避免偷做 M3 |

---

## 三、架构

### 依赖关系

```
                  ┌─────────────────────────────┐
  HTTP 外部  ───→ │  /api/memory/*  (Express)   │
                  └──────────────┬──────────────┘
                                 │
  未来 S3.x ─同进程 import──→    ▼
                  ┌─────────────────────────────┐
                  │      MemoryService           │  ← 业务逻辑 + 归属校验
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────┴──────────────┐
                  ▼                             ▼
        ConversationRepository          MessageRepository
                  │                             │
                  └──────────────┬──────────────┘
                                 │ Kysely
                                 ▼
                          MySQL 8 · InnoDB
                  ┌──────────────┬──────────────┐
                  │conversations │   messages   │
                  └──────────────┴──────────────┘

  S1.1 users ────← FK CASCADE (user_id)
```

### 目录结构

```
src/modules/memory/
├── routes.ts                         # HTTP 路由挂载(带 requireSession)
├── schema.ts                         # zod 请求/响应 schema
├── controllers/
│   └── memory.controller.ts         # 薄 controller:解析 → 调 service → 响应
├── services/
│   └── memory.service.ts            # MemoryService:业务逻辑 + 权限校验
├── repositories/
│   ├── conversation.repository.ts
│   └── message.repository.ts
└── domain/
    ├── conversation.ts              # Conversation 类型
    ├── message.ts                   # Message + MessageRole 类型
    └── errors.ts                    # ConversationNotFoundError 等
```

**不带 `events.ts`**:问题 5 决定不做事件订阅。

### 装配(main.ts 延续 S1.1 手工装配风格)

```typescript
const conversationRepo = new ConversationRepository(db);
const messageRepo = new MessageRepository(db);
const memory = new MemoryService(conversationRepo, messageRepo, db);
const memoryController = new MemoryController(memory);
app.use('/api/memory', buildMemoryRoutes(memoryController, requireSession));
```

`db` 传入是为了 `addMessage` 的 insert + touch 同事务封装。

---

## 四、数据模型

### 表 1:`conversations`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | CHAR(26) | PK | ULID,延续 S1.1 风格 |
| `user_id` | CHAR(26) | NOT NULL, FK → `users(id)` ON DELETE CASCADE | 归属用户 |
| `title` | VARCHAR(200) | NULL | 可空;M1 由调用方传或不传;M3 可 AI 自动生成 |
| `created_at` | DATETIME(3) | NOT NULL, DEFAULT CURRENT_TIMESTAMP(3) | 毫秒精度,对齐 S1.1 |
| `updated_at` | DATETIME(3) | NOT NULL, DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) | 加消息时显式 touch |

**索引**:
- PRIMARY KEY (`id`)
- KEY `idx_conversations_user_updated` (`user_id`, `updated_at` DESC) — 支撑"我最近的会话"列表页

### 表 2:`messages`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | CHAR(26) | PK | ULID |
| `conversation_id` | CHAR(26) | NOT NULL, FK → `conversations(id)` ON DELETE CASCADE | 会话删则消息级联删 |
| `role` | VARCHAR(16) | NOT NULL, CHECK (`role` IN ('user','ai','system')) | VARCHAR + CHECK 便于未来加值(如 `tool`)|
| `content` | TEXT | NOT NULL | 64KB;M1 不存图片/大附件 |
| `created_at` | DATETIME(3) | NOT NULL, DEFAULT CURRENT_TIMESTAMP(3) | 时序唯一来源 |

**索引**:
- PRIMARY KEY (`id`)
- KEY `idx_messages_conversation_created` (`conversation_id`, `created_at` ASC) — 支撑会话消息顺序读取

### 跨表约定(写进 design,作为 M3 演进锚点)

未来 M3 新建的任何记忆表(如 `artifact_snapshots` / `user_events`)遵守:

1. **主键**:`CHAR(26)` ULID
2. **归属**:`user_id CHAR(26) NOT NULL, FK → users(id) ON DELETE CASCADE`
3. **时间戳**:`created_at DATETIME(3)` 必备;变更类表加 `updated_at DATETIME(3) ON UPDATE CURRENT_TIMESTAMP(3)`
4. **软删**:M1/M3 阶段**不做**;撤销类需求以"业务事件表"承载,不加 `deleted_at` 字段
5. **命名**:表名复数蛇形;字段名蛇形

### 容量预估

单用户每天活跃对话 3-5 条 × 每对话 20 条消息 → 年累计 ≈ 1.8 万 `conversations` + 36 万 `messages`。远低于 InnoDB 分表临界。**M1 不做分表准备**。

---

## 五、接口设计

### Domain 类型

```typescript
// domain/conversation.ts
export type Conversation = {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// domain/message.ts
export type MessageRole = 'user' | 'ai' | 'system';
export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};
```

### Repository 接口

```typescript
class ConversationRepository {
  create(input: { userId: string; title?: string | null }): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  listByUser(userId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Conversation[]; nextCursor: string | null }>;
  touchUpdatedAt(id: string): Promise<void>;
  deleteById(id: string): Promise<void>;
}

class MessageRepository {
  create(input: { conversationId: string; role: MessageRole; content: string }): Promise<Message>;
  listByConversation(conversationId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Message[]; nextCursor: string | null }>;
}
```

### Service 接口(**M1 核心对外 API**)

```typescript
class MemoryService {
  constructor(
    private conversations: ConversationRepository,
    private messages: MessageRepository,
    private db: Kysely<Database>,   // 用于 addMessage 的事务
  ) {}

  createConversation(userId: string, input: { title?: string | null }): Promise<Conversation>;
  listConversations(userId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Conversation[]; nextCursor: string | null }>;
  getConversation(userId: string, id: string): Promise<Conversation>;
  deleteConversation(userId: string, id: string): Promise<void>;
  addMessage(userId: string, conversationId: string, input: { role: MessageRole; content: string }):
    Promise<Message>;
  listMessages(userId: string, conversationId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Message[]; nextCursor: string | null }>;
}
```

**契约**:
- 每个方法首参 `userId`,内部强制校验归属
- 归属不符 → `ConversationForbiddenError`(403)。**不做 404 掩饰** —— M1 是内部系统,明示更易调试
- `addMessage` 是组合动作:`messages.create` + `conversations.touchUpdatedAt`,**同事务**

---

## 六、HTTP 契约

### 公共约定

- 统一前缀:`/api/memory`
- 所有端点先过 `requireSession`
- 请求体用 zod 校验,失败 → 400 `VALIDATION_FAILED`
- 错误响应格式:`{ "code": "...", "message": "..." }`(对齐 S1.1);`VALIDATION_FAILED` 额外带 `details`
- 时间字段:ISO 8601 字符串(`2026-04-23T10:15:30.123Z`)
- 分页:cursor-based,`nextCursor` 为 null 表示到底

### 1. 创建会话 · `POST /api/memory/conversations`

**Body**:
```json
{ "title": "想做一个记账 app" }
```

- `title`:可选。长度 1-200;空字符串等价于不传(存 NULL)

**201 Created**:
```json
{
  "id": "01K4...",
  "userId": "01H9...",
  "title": "想做一个记账 app",
  "createdAt": "2026-04-23T10:15:30.123Z",
  "updatedAt": "2026-04-23T10:15:30.123Z"
}
```

### 2. 列出会话 · `GET /api/memory/conversations`

**Query**:
- `limit`(可选,默认 20,最大 100)
- `cursor`(可选,opaque base64)

**200 OK**:
```json
{
  "items": [ /* Conversation[] */ ],
  "nextCursor": "eyJ1cGRhdGVkQXQi..."
}
```

**排序**:`updated_at DESC, id DESC`(updated_at 相同时靠 id 稳定)

### 3. 查单个会话 · `GET /api/memory/conversations/:id`

**200 OK**:返回 Conversation 对象(不含消息)。
**403** `CONVERSATION_FORBIDDEN` | **404** `CONVERSATION_NOT_FOUND`

### 4. 删除会话 · `DELETE /api/memory/conversations/:id`

**204 No Content** | **403** | **404**

FK CASCADE 级联删消息。

### 5. 追加消息 · `POST /api/memory/conversations/:id/messages`

**Body**:
```json
{ "role": "user", "content": "帮我设计数据库" }
```

- `role`:必须 ∈ `{'user','ai','system'}`
- `content`:非空,长度 1-65535

**201 Created**:
```json
{
  "id": "01K4...",
  "conversationId": "...",
  "role": "user",
  "content": "帮我设计数据库",
  "createdAt": "2026-04-23T10:15:40.456Z"
}
```

**副作用(同事务)**:`UPDATE conversations SET updated_at = NOW(3) WHERE id = :id`

**403** / **404**:同上

### 6. 列出消息 · `GET /api/memory/conversations/:id/messages`

**Query**:
- `limit`(可选,默认 50,最大 200)
- `cursor`(可选)

**200 OK**:
```json
{
  "items": [ /* Message[] */ ],
  "nextCursor": null
}
```

**排序**:`created_at ASC, id ASC`(对话按时间正序回放)
**403** / **404**:同上

### 错误码清单

| Code | HTTP | 场景 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | zod 失败,带 details |
| `UNAUTHENTICATED` | 401 | `requireSession` 抛出 |
| `CONVERSATION_FORBIDDEN` | 403 | 对话存在但不属于当前用户 |
| `CONVERSATION_NOT_FOUND` | 404 | 对话 id 不存在 |
| `INVALID_MESSAGE_ROLE` | 400 | zod 之后的兜底,理论不触发 |

---

## 七、错误处理

完全复用 S1.1 的 `AppError` + `errorHandler` middleware。

### 新增业务错误(`domain/errors.ts`)

```typescript
import { AppError } from '../../../core/errors';

export class ConversationNotFoundError extends AppError {
  constructor() { super('CONVERSATION_NOT_FOUND', '会话不存在', 404); }
}

export class ConversationForbiddenError extends AppError {
  constructor() { super('CONVERSATION_FORBIDDEN', '无权访问该会话', 403); }
}

export class InvalidMessageRoleError extends AppError {
  constructor() { super('INVALID_MESSAGE_ROLE', 'role 取值非法', 400); }
}
```

### 日志

- 每个业务错误由 errorHandler 打 `warn`,含 `requestId` + `userId`
- **`content` 字段不入日志**(可能含敏感内容,长度也不定)
- 错误响应不泄露内部栈信息

---

## 八、测试策略

对齐 S1.1 三档结构。

### 1. Unit(`test/unit/memory/`)

- `memory.service.test.ts`
  - 创建会话:`userId` 被正确透传
  - `getConversation`:不是本人 → `ConversationForbiddenError`(不是 404)
  - `addMessage`:触发 `conversations.touchUpdatedAt`(用 spy 验证)+ 创建 message
  - `deleteConversation`:不是本人 → 403;本人 → 调 repo.deleteById
  - `listConversations` / `listMessages` cursor 解析/生成
- `schema.test.ts` — zod 边界(title 长度 / role 取值 / content 长度)

### 2. Integration(`test/integration/memory/`)

- `conversation.repository.int.test.ts`(testcontainers 启 MySQL 8)
  - CRUD
  - `listByUser` 分页正确性 + 排序稳定
  - `touchUpdatedAt` 真正更新时间戳
- `message.repository.int.test.ts`
  - `listByConversation` 按 `created_at ASC` 返回
  - FK CASCADE:删 conversation → SQL 直查关联 messages 清零
- `migration.int.test.ts` — up/down 可重入

### 3. E2E(`test/e2e/memory.e2e.test.ts`)

supertest 打完整链路,**先通过 S1.1 login 拿 cookie**:

- 未带 cookie → 6 个端点全 401
- Golden path:创建会话 → 加消息 × 2 → 列消息(顺序正确)→ 列会话(看 updated_at 已变)→ 删会话 → 再查 → 404
- 跨用户隔离:A 创建,B 访问 → 403
- zod 校验:invalid role → 400 `VALIDATION_FAILED`

### 手工 Smoke(`docs/qa/s2-memory-manual-checklist.md`)

对齐 S1.1 的报告模板,预计 15-20 项:
- 健康检查 + 登录前置
- 6 个端点 golden path
- 跨用户 → 403、无 cookie → 401
- 日志不出现 `content` 明文(grep 验证)
- 删会话级联消息

---

## 九、非功能性约束

| 维度 | 约束 |
|---|---|
| **性能** | 单机 MySQL。热路径查询全走索引;不做缓存 |
| **并发** | M1 单用户串行;`addMessage` 的 insert + touch 同事务 |
| **安全** | 鉴权复用 S1.1;`content` 不入日志;不新增鉴权路径 |
| **可观测** | pino 日志 + requestId(照 S1.1);不加 metrics,M3 再补 |
| **数据保留** | 无 TTL,无自动清理;用户主动删或注销 CASCADE |
| **兼容性** | 首次发布,无历史包袱 |

---

## 十、与 S1.1 的连接点

- `users.id` 是所有记忆表的归属根
- `requireSession` middleware 直接 import 复用,注入 `req.user.id`
- 注销 cascade delete:注销后记忆全清 —— **这是目标行为**。M3 S2.5 做完整治理时才有"导出 / 保留快照"的选项
- 错误体系复用 `AppError` + `errorHandler`;响应格式对齐

---

## 十一、实现顺序提示(给 writing-plans)

大致建议(最终 plan 会细化):

1. Migration(建表 + 索引)
2. Domain 类型 + 错误类
3. Repositories(先 conversation 后 message)
4. Service(组合 repo + 事务)
5. zod schema
6. Controller + Routes
7. 装配进 main.ts
8. 三档测试(unit → integration → e2e)
9. Smoke 清单文档

---

*本设计基于 2026-04-23 brainstorming 对话生成。14 个决策见第二节。*
