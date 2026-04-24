# S3.2 · 产物模型(Artifact Model)设计

> **范围**:moon-agent-os 平台 L3 层生成引擎的 **S3.2 产物模型**(Vision 文档里程碑 M2 的一部分)。
>
> **定位**:**平台契约中心**。所有形态(web/app/mcp/skill/工作流/agent)都以此模型为基础,版本、血缘、元数据统一。

**生成日期**: 2026-04-24
**依赖**: S1.1 账户与身份(已完成)
**并行**: S2 记忆中枢 M1(另分支开发中)
**参考**: `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`

---

## 一、目标与边界

### S3.2 要交付什么

一个统一的 artifact(产物)数据模型与访问 Service,支撑所有形态的产物以同一套骨架描述。版本通过 `parent_artifact_id` 链式表达;归属、状态、来源均有明确契约。

**必须具备**:
- `artifacts` 单表,通用骨架 + 形态特定 payload(JSON)
- Schema Registry 机制:按 kind 注册 zod schema,写入时 validate
- 硬绑定 user_id;parent_artifact_id FK ON DELETE SET NULL
- `ArtifactService` 4 方法:`create` / `getById` / `listByUser` / `retire`
- M2 阶段只注册 `web` 一个 kind,**但 registry 机制完整**

**明确不做**(留给未来):
- ❌ HTTP API / Controller / Routes(M2 阶段无用户直接消费;未来 S4.1 管理面板再做)
- ❌ `delete` 方法(用 `retire` 替代,保留历史)
- ❌ `update` 方法(变更 = 新建 artifact + parent 指向)
- ❌ `fork` 方法(M5 S5.3 再做,含跨用户权限)
- ❌ 其他 kind 的 payload schema(只有 `web`)
- ❌ 按 payload 内部字段检索
- ❌ 事务(所有方法都是单 SQL)

### 语义定位

- **artifact 即版本**:每次生成/迭代/fork 都是新 artifact 行,靠 `parent_artifact_id` 链接前身
- **契约分层**:骨架字段(平台级契约)+ payload(kind 级契约,由 schema registry 校验)
- **只做存储与规则,不做生成与运行**:生成是 S3.3 的事,运行是 S3.4 的事

---

## 二、关键决策

| # | 维度 | 决策 | 理由 |
|---|---|---|---|
| 1 | 骨架 | 最小共性 + 版本血缘(origin + parent_artifact_id) | A 太轻放弃"契约中心"价值;C 太超前约束未来子系统 |
| 2 | 形态特定内容 | 统一 `payload JSON` + 代码级 schema registry | 单 JSON 太松无契约;分表方案每加 kind 改 migration 爆炸 |
| 3 | M2 注册的 kind | 只注册 `web`,但 registry 机制完整建立 | M2 只做 S4.1 网页形态;其他 kind 由对应形态 brainstorm 时加入 |
| 4 | 版本建模 | 每版本一行,靠 `parent_artifact_id` 链 | 对齐"日抛型"理念;分表过度建模;history 表是软删变种 |
| 5 | origin 取值 | ENUM 4 值:`user_intent/iteration/fork/install` | 有限封闭集;在 vision 文档里清单已明确;一次定完减少未来 ALTER TABLE |
| 6 | 归属 | 硬绑定 `user_id`;`parent_artifact_id` FK ON DELETE SET NULL | fork 是复制语义,不是多所有权;父删不能连累孩子 |
| 7 | status | 两态 `ready`/`retired`,默认 ready;单向 retire | draft 属 Forge 瞬态,不该入契约中心;hard delete 丢历史 |
| 8 | API 形态 | 只做 Service,无 HTTP | 消费方全是同进程平台模块;payload 可能大不适合 HTTP |
| 9 | 测试 | unit + integration 两档,无 e2e | 无 HTTP 层;integration 覆盖 FK/CHECK;契约测试是预测性陷阱 |
| 10 | 文件组织 | `src/modules/artifact/` 延续 S1.1/S2 + 新增 `registry/` 子目录 | 不建空 controllers/;registry 作为核心组件单独成子目录 |
| 11 | Service 方法 | 4 个:`create` / `getById` / `listByUser` / `retire` | `update` 破坏"artifact 即版本"语义;`fork` 是 M5 S5.3 的事 |

---

## 三、架构

### 依赖与消费关系

```
                    ┌──────────────────────────────────────┐
  未来 M2+:         │  ArtifactService(TS API)           │
  S3.1 意图捕获 ──→ │                                      │
  S3.3 流水线   ──→ │  create / getById                    │
  S3.4 运行时   ──→ │                                      │
  S4.1 网页形态 ──→ │  listByUser                          │
                    │                                      │
  用户 retire ───→  │  retire                              │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
          ArtifactSchemaRegistry         ArtifactRepository
          (InMemory, 启动时固化)         (Kysely)
                    │                             │
                    │ validate(kind, payload)     │ SQL
                    ▼                             ▼
          [web.schema, ...]              MySQL 8 · artifacts 表

          S1.1 users ←── FK CASCADE (user_id)
          self      ←── FK SET NULL (parent_artifact_id)
```

### 目录结构

```
src/modules/artifact/
├── schema.ts                        # zod input schema(service 入参校验)
├── services/
│   └── artifact.service.ts
├── repositories/
│   └── artifact.repository.ts
├── domain/
│   ├── artifact.ts                  # Artifact 类型 + ArtifactKind / ArtifactOrigin / ArtifactStatus
│   └── errors.ts                    # ArtifactNotFoundError / ArtifactForbiddenError / InvalidPayloadError
└── registry/
    ├── index.ts                     # InMemoryArtifactSchemaRegistry
    └── web.schema.ts                # web kind 的 payload schema
```

**不带 `controllers/` / `routes.ts`**:决策 8 决定 M2 阶段不做 HTTP。

### 装配(main.ts 延续 S1.1/S2 手工装配风格)

```typescript
const artifactRegistry = new InMemoryArtifactSchemaRegistry();
artifactRegistry.register('web', WebArtifactPayload);
// 未来加 mcp/skill 在这里加一行

const artifactRepo = new ArtifactRepository(db);
const artifactService = new ArtifactService(artifactRepo, artifactRegistry);

// 不挂 HTTP 路由;artifactService 作为"平台内部模块"
// 供未来 S3.1/S3.3/S3.4 在 buildApp() 里作为构造参数传入
```

---

## 四、数据模型

### 表:`artifacts`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | CHAR(26) | PK | ULID |
| `user_id` | CHAR(26) | NOT NULL, FK → `users(id)` ON DELETE CASCADE | 归属用户 |
| `kind` | VARCHAR(32) | NOT NULL | 形态类型。M2 只有 `web`。**DB 不加 CHECK** —— 应用层 registry 校验 |
| `title` | VARCHAR(200) | NOT NULL | 必填 |
| `payload` | JSON | NOT NULL | 形态特定内容。由 registry 按 kind 校验 |
| `status` | VARCHAR(16) | NOT NULL DEFAULT 'ready', CHECK (`status` IN ('ready','retired')) | 默认 ready;单向 retire |
| `origin` | VARCHAR(32) | NOT NULL, CHECK (`origin` IN ('user_intent','iteration','fork','install')) | M2 只写 `user_intent` |
| `parent_artifact_id` | CHAR(26) | NULL, FK → `artifacts(id)` ON DELETE SET NULL | 前身,可跨用户 |
| `created_at` | DATETIME(3) | NOT NULL | 应用层传入 |

**索引**:
- PRIMARY KEY (`id`)
- KEY `idx_artifacts_user_created` (`user_id`, `created_at` DESC)
- KEY `idx_artifacts_user_kind_status` (`user_id`, `kind`, `status`)
- KEY `idx_artifacts_parent` (`parent_artifact_id`)
- FK `fk_artifacts_user` → `users(id)` ON DELETE CASCADE
- FK `fk_artifacts_parent` → `artifacts(id)` ON DELETE SET NULL

**关键设计点**:

1. **`kind` 不加 DB CHECK 约束**:kind 可扩展(M4 分阶段铺 7 种),加 CHECK 每加一种都要 ALTER TABLE。应用层 schema registry 是 kind 合法性的唯一权威
2. **`origin` / `status` 加 DB CHECK**:有限封闭集,CHECK 做第二层兜底
3. **`parent_artifact_id` FK 不限制同用户**:跨用户 parent 是 fork 场景合法需求
4. **`title` 不可空**:artifact 必须能被列出展示
5. **无 `updated_at` 字段**:artifact 即版本,数据一旦创建就不变;要改 = 新建 artifact

### 跨表约定

完全遵守 S2 design 里已确立的约定:主键 CHAR(26) ULID、归属 user_id FK CASCADE、时间戳 DATETIME(3)、命名复数蛇形、不加 deleted_at。

新增一条跨表约定(**只适用于血缘类字段**):
- 血缘字段统一命名 `parent_<entity>_id`,FK ON DELETE SET NULL(孤立节点但不级联删)

### 容量预估

单用户日均 5-10 次生成 → 年累计 ~3000 条。payload 均值 50KB-500KB(web bundle) → 年数据量 ~0.5-1.5 GB。InnoDB 单表 TB 级无压力,M2 不做分表。

未来如果 payload 过大(>数 MB),扩展路径:加 `payload_ref` 字段指向 OSS。S3.3 Forge Pipeline 决定存储策略,不是 S3.2 的事。

---

## 五、Schema Registry 机制

### 接口

```typescript
// src/modules/artifact/registry/index.ts

import type { ZodTypeAny } from 'zod';

export type ArtifactKind = string;

export interface ArtifactSchemaRegistry {
  register(kind: ArtifactKind, schema: ZodTypeAny): void;
  has(kind: ArtifactKind): boolean;
  validate(kind: ArtifactKind, payload: unknown): unknown;
  listKinds(): ArtifactKind[];
}
```

**`validate` 返回 `unknown`**:registry 按字符串 kind 查,TS 编译时无法推类型。消费方拿到 validated payload 后按 kind 自行收窄(例如 `if (kind === 'web') payload as WebArtifactPayload`)。

### 实现

```typescript
import { type ZodTypeAny } from 'zod';
import { InvalidPayloadError } from '../domain/errors';

export class InMemoryArtifactSchemaRegistry implements ArtifactSchemaRegistry {
  private readonly schemas = new Map<ArtifactKind, ZodTypeAny>();

  register(kind: ArtifactKind, schema: ZodTypeAny): void {
    if (this.schemas.has(kind)) throw new Error(`kind "${kind}" already registered`);
    this.schemas.set(kind, schema);
  }

  has(kind: ArtifactKind): boolean { return this.schemas.has(kind); }

  validate(kind: ArtifactKind, payload: unknown): unknown {
    const schema = this.schemas.get(kind);
    if (!schema) throw new InvalidPayloadError(`unknown kind: ${kind}`);
    const r = schema.safeParse(payload);
    if (!r.success) throw new InvalidPayloadError('payload schema validation failed', r.error.flatten());
    return r.data;
  }

  listKinds(): ArtifactKind[] { return [...this.schemas.keys()]; }
}
```

**设计原则**:**启动时固化**。registry 在 buildApp() 里完成全部注册,运行期不再修改,避免运行时竞态。

### Web kind 的 payload schema

```typescript
// src/modules/artifact/registry/web.schema.ts

import { z } from 'zod';

export const WebArtifactPayload = z.object({
  entryHtml: z.string().min(1),
  assets: z.record(z.string()).optional(),
  metadata: z.object({
    generatedBy: z.string(),
    generatedAt: z.string().datetime(),
  }),
});

export type WebArtifactPayload = z.infer<typeof WebArtifactPayload>;
```

**这是最小可用版本**。真实 web artifact 形状会在 S3.3 Forge Pipeline / S4.1 网页形态 brainstorm 时迭代细化。S3.2 阶段只需满足:有主要内容(`entryHtml`)、有附属资源(`assets`,可选)、有生成元信息(`metadata`)。

### 新增 kind 的流程(未来参考)

M4 铺新形态时加一种 kind:

1. 创建 `src/modules/artifact/registry/<kind>.schema.ts`,定义 zod schema
2. 在 `main.ts` 装配处 `registry.register('<kind>', <kind>Payload)`
3. 测试里 test registry 可自行注册测试专用 kind

**不改**:`artifacts` 表结构、`ArtifactService`、`ArtifactRepository`。

---

## 六、Service 接口与行为契约

### Domain 类型

```typescript
// src/modules/artifact/domain/artifact.ts

export type ArtifactKind = string;
export type ArtifactStatus = 'ready' | 'retired';
export type ArtifactOrigin = 'user_intent' | 'iteration' | 'fork' | 'install';

export type Artifact = {
  id: string;
  userId: string;
  kind: ArtifactKind;
  title: string;
  payload: unknown;
  status: ArtifactStatus;
  origin: ArtifactOrigin;
  parentArtifactId: string | null;
  createdAt: Date;
};

export const ARTIFACT_STATUSES: readonly ArtifactStatus[] = ['ready', 'retired'] as const;
export const ARTIFACT_ORIGINS: readonly ArtifactOrigin[] = ['user_intent', 'iteration', 'fork', 'install'] as const;
```

### Domain 错误

```typescript
// src/modules/artifact/domain/errors.ts

import { AppError } from '../../../core/errors';

export class ArtifactNotFoundError extends AppError {
  readonly code = 'ARTIFACT_NOT_FOUND';
  readonly status = 404;
  constructor() { super('产物不存在'); }
}

export class ArtifactForbiddenError extends AppError {
  readonly code = 'ARTIFACT_FORBIDDEN';
  readonly status = 403;
  constructor() { super('无权访问该产物'); }
}

export class InvalidPayloadError extends AppError {
  readonly code = 'INVALID_ARTIFACT_PAYLOAD';
  readonly status = 400;
  constructor(message: string, readonly details?: unknown) { super(message); }
}
```

**说明**:虽然 S3.2 无 HTTP,错误类继承 AppError。未来任何消费方接错误后,通过既有 errorHandler 自动转响应。零成本维持全平台一致。

### Service 接口

```typescript
// src/modules/artifact/services/artifact.service.ts

export type CreateArtifactInput = {
  kind: ArtifactKind;
  title: string;
  payload: unknown;
  origin: ArtifactOrigin;
  parentArtifactId?: string | null;
};

export type ListArtifactsOptions = {
  limit: number;
  cursor?: string | null;
  kind?: ArtifactKind;
  status?: ArtifactStatus;
};

export class ArtifactService {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly registry: ArtifactSchemaRegistry,
  ) {}

  create(userId: string, input: CreateArtifactInput): Promise<Artifact>;
  getById(userId: string, id: string): Promise<Artifact>;
  listByUser(userId: string, opts: ListArtifactsOptions): Promise<{ items: Artifact[]; nextCursor: string | null }>;
  retire(userId: string, id: string): Promise<void>;
}
```

### Service 行为契约

**`create`**:
1. `registry.validate(input.kind, input.payload)`,失败抛 `InvalidPayloadError`
2. 如果 `parentArtifactId` 非 null,校验 parent 存在(否则抛 `ArtifactNotFoundError`)。parent 可属任何用户,**不做归属校验**(fork 合法)
3. 生成 ULID `id`,`createdAt = new Date()`,默认 `status = 'ready'`
4. insert;返回完整 Artifact

**`getById`**:
1. findById
2. 不存在 → `ArtifactNotFoundError`
3. `userId` 不匹配 → `ArtifactForbiddenError`
4. 返回 Artifact(payload 不再 validate,信任 DB 数据)

**`listByUser`**:
1. 按 `user_id` 过滤
2. 可选按 `kind` 过滤
3. `status` 默认 `'ready'`;传 `'retired'` 只查 retired
4. Cursor 分页:`(created_at, id)` DESC
5. 归属由查询条件保证,不抛 Forbidden

**`retire`**:
1. getById(复用归属检查)
2. 已 retired → 幂等直接返回
3. 否则 `updateStatus('retired')`

### Repository 接口

```typescript
// src/modules/artifact/repositories/artifact.repository.ts

export class ArtifactRepository {
  constructor(private readonly db: Kysely<Database>) {}

  insert(a: {
    id: string;
    userId: string;
    kind: ArtifactKind;
    title: string;
    payload: unknown;
    status: ArtifactStatus;
    origin: ArtifactOrigin;
    parentArtifactId: string | null;
    now: Date;
  }): Promise<void>;

  findById(id: string): Promise<Artifact | null>;

  listByUser(userId: string, opts: {
    limit: number;
    cursor?: string | null;
    kind?: ArtifactKind;
    status?: ArtifactStatus;
  }): Promise<{ items: Artifact[]; nextCursor: string | null }>;

  updateStatus(id: string, status: ArtifactStatus): Promise<void>;
}
```

**Repository 职责**:
- 纯 SQL,不做权限、不调 registry
- JSON payload 写入 `JSON.stringify`(Kysely 默认);读出 mysql2 driver 自动 parse
- rowToArtifact 做 DB row → domain 类型转换

**注意**:payload 从 DB 读出是 `unknown`,不再 validate。它是"我们自己之前 validate 过的数据",信任它。schema 未来演化若旧数据不符新 schema,那是"schema 迁移"问题。

### Database 类型扩展

```typescript
// src/core/db.ts — 新增

export type ArtifactRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  payload: unknown;
  status: 'ready' | 'retired';
  origin: 'user_intent' | 'iteration' | 'fork' | 'install';
  parent_artifact_id: string | null;
  created_at: Date;
};

// Database 类型加上:
//   artifacts: ArtifactRow;
```

### 为什么 Service 不接受事务?

所有方法单 SQL:create = 1 insert;retire = 1 update。**保持 Service 干净不拉 db 依赖**。未来 fork + 复制 payload + 记录血缘(M5 S5.3)需要事务时再加。YAGNI。

---

## 七、错误处理

复用 S1.1 的 `AppError` + `errorHandler`。3 个业务错误:
- `ArtifactNotFoundError` (404) — 产物不存在
- `ArtifactForbiddenError` (403) — 跨用户访问
- `InvalidPayloadError` (400) — registry validate 失败,带 `details`

---

## 八、测试策略

**unit + integration 两档,无 e2e**(无 HTTP 层)。

### 1. Unit(`test/unit/artifact/`)

- **`registry.test.ts`**:
  - `register` + `has` 可查
  - 重复 register 同 kind 抛 Error
  - `validate(unknown_kind)` 抛 `InvalidPayloadError`
  - `validate(kind, valid)` 返回 parsed data
  - `validate(kind, invalid)` 抛 `InvalidPayloadError` 带 zod errors
  - `listKinds` 返回全量
  - **使用独立 test kind**,不复用 web.schema
- **`web.schema.test.ts`**:
  - 合法 payload(最小字段、带 assets)通过
  - 缺 `entryHtml` / 空 `entryHtml` / `metadata.generatedAt` 非 ISO 均失败
- **`artifact.service.test.ts`**(mock repository + mock registry):
  - `create`:
    - registry.validate 调用;失败时 insert **不被调**
    - 生成 ULID;默认 `status='ready'`
    - `parentArtifactId` 非 null 时校验 parent 存在;不存在抛 `ArtifactNotFoundError`
    - `parentArtifactId` 指向**别的用户**的 artifact → 不抛错
  - `getById`:自己的返回;不存在 NotFound;别人的 Forbidden
  - `listByUser`:opts 透传;status 未传时 service 显式传 `'ready'`
  - `retire`:自己的 ready → updateStatus;已 retired 幂等;别人的 Forbidden

### 2. Integration(`test/integration/artifact/`)

- **`migration.int.test.ts`**:
  - `artifacts` 表 + 列齐全
  - `status` CHECK 生效(非法值失败)
  - `origin` CHECK 生效
  - `kind` **无** DB CHECK(任意字符串不失败)
- **`artifact.repository.int.test.ts`**:
  - insert + findById 圆环
  - listByUser 按 (created_at, id) DESC
  - listByUser 按 kind / status 过滤
  - Cursor 分页
  - updateStatus 改字段
  - **FK 行为**:
    - `user_id` ON DELETE CASCADE:真 DELETE 用户级联删 artifact
    - `parent_artifact_id` ON DELETE SET NULL:删 parent 后 child.parent_artifact_id = NULL
  - payload JSON 存取:写对象,读出仍对象

### 手工 Smoke(不需要)

S3.2 无 HTTP、无用户直接交互。冒烟由未来 M2 的 S3.1/S4.1 消费方间接覆盖。

---

## 九、非功能性约束

| 维度 | 约束 |
|---|---|
| **性能** | 单机 MySQL;三索引覆盖所有查询;payload 最大 ~1MB;不做缓存 |
| **并发** | User-per-request 串行;retire 幂等 |
| **安全** | 无 HTTP 无鉴权;Service 调用方必须传可信 userId(上层保证) |
| **可观测** | pino 日志;关键路径打 info/warn;**payload 内容不入日志** |
| **数据保留** | 无 TTL;retire 不删;user CASCADE 才清 |
| **兼容性** | 首次发布;不预留 `payload_ref` 等未用字段 |

---

## 十、与已有系统的连接点

| 连接 | 方式 |
|---|---|
| **S1.1 身份** | `users.id` → `artifacts.user_id` FK CASCADE。Service 依赖调用方传入 `userId`(正确性由上层保证) |
| **S2 记忆** | 无直接依赖。未来 S3.5 迭代循环会读记忆 + 生成新 artifact;S3.2 不需要知道记忆存在 |
| **核心基础设施** | 复用 `AppError` / `errorHandler` / `core/db` / ULID / zod / Kysely |
| **未来 M2 消费方** | S3.1 意图捕获 / S3.3 流水线 / S3.4 运行时 / S4.1 网页形态,通过 `import { ArtifactService }` 同进程调用 |
| **未来 M3+** | S3.5 迭代循环(`origin='iteration'` + `parentArtifactId`);S5.3 fork(`origin='fork'`) |

---

## 十一、实现顺序提示(给 writing-plans)

大致建议:

1. Migration(建 artifacts 表 + 索引 + CHECK 约束)
2. Domain 类型 + 错误类 + 常量
3. Schema Registry 机制(InMemoryArtifactSchemaRegistry + 单测)
4. Web kind schema(web.schema.ts + 单测)
5. Repository(CRUD,单纯 SQL)
6. Service(组合 registry + repo,业务逻辑 + 权限校验)
7. Unit 测试(service)
8. Integration 测试(migration + repository FK/CHECK)
9. 装配进 main.ts(不挂路由)
10. Typecheck + 全量测试绿

---

*本设计基于 2026-04-24 brainstorming 对话生成。11 个决策见第二节。*
