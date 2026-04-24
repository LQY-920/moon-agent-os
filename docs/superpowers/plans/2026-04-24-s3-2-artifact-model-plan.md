# S3.2 Artifact Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 moon-agent-os 加一个 artifact(产物)数据模型 —— 平台契约中心。任何形态(web/app/mcp/skill 等)的产物都用同一张 `artifacts` 表 + 同一套 Service API,payload 按 kind 由 schema registry 校验。

**Architecture:** 新增 `src/modules/artifact/` 模块。单表 `artifacts` + JSON payload 字段,应用层 InMemoryArtifactSchemaRegistry 按 kind 注册 zod schema。**无 HTTP 层** —— 只暴露 `ArtifactService` 同进程 TS API,供未来 M2 子系统(S3.1/S3.3/S3.4/S4.1)import 使用。版本血缘通过 `parent_artifact_id` 自引用 FK 实现,ON DELETE SET NULL 保留孤儿节点。

**Tech Stack:** TypeScript / Express 5 / Kysely / MySQL 8(JSON 字段 + CHECK 约束)/ zod / ULID / vitest / testcontainers。沿用 S1.1/S2 既有依赖,不新增 npm 包。

**Spec:** `docs/superpowers/specs/2026-04-24-s3-2-artifact-model-design.md`

**分支:** `feature/s3-2-artifact-model`(已存在,spec 已 commit `94dfb70`,基于 `origin/main` 最新)

---

## 实现前的关键上下文

实现工程师可能没看过 S1.1 / S2 完整代码,下面是 5 条**必读**上下文,直接决定若干 Task 里的代码形状:

1. **`Kysely<Database>` 类型跨事务通用**:S2 的 repository 方法 `executor?: Kysely<Database>` 接收的是普通 db 句柄或事务句柄(不用 `Transaction<Database>` 这个类型,因为 Kysely 的 transaction().execute 回调给的 tx 也能 assign 给 `Kysely<Database>` 参数)。**S3.2 不需要事务,所有 repository 方法都不带 executor 参数**
2. **`AppError` 子类模式**:S1.1/S2 都用 `readonly code = 'XXX' as const; readonly status = N;` 属性赋值,不在构造函数里写。参考 `src/modules/identity/domain/errors.ts` 和 `src/modules/memory/domain/errors.ts`
3. **migration 文件命名**:`YYYYMMDD_NNN_<name>.ts`,NNN 在当前 codebase 是 001 (identity) + 002 (memory),**S3.2 是 003**;文件名 `20260424_003_init_artifact.ts`
4. **JSON 字段在 mysql2 + Kysely 里的行为**:mysql2 在默认配置下**读取 JSON 列时会自动 parse 成对象/数组**;写入时 Kysely 不会自动 stringify —— 需要**显式 `JSON.stringify(payload)`**(否则 Kysely 会传 `[object Object]` 字符串过去)。这在 Task 7 repository 里体现
5. **`test/integration/setup.ts` 的 API**:导出 `startTestDb()`,返回 `{ container, db, destroy }`。测试必须在 `beforeAll` 调 `startTestDb()`,`afterAll` 调 `destroy`。每个 integration 测试文件启一个独立 MySQL 容器(慢但隔离)

---

## 文件结构

**新增**:

```
migrations/
└── 20260424_003_init_artifact.ts             # 单表 artifacts

src/modules/artifact/
├── services/
│   └── artifact.service.ts                    # ArtifactService 类
├── repositories/
│   └── artifact.repository.ts                 # ArtifactRepository(含 rowToArtifact + cursor 本地副本)
├── domain/
│   ├── artifact.ts                            # Artifact 类型 + ArtifactKind/Origin/Status + 常量
│   └── errors.ts                              # ArtifactNotFoundError / ArtifactForbiddenError / InvalidPayloadError
└── registry/
    ├── index.ts                               # ArtifactSchemaRegistry 接口 + InMemoryArtifactSchemaRegistry 实现
    └── web.schema.ts                          # web kind 的 payload zod schema

test/unit/artifact/
├── registry.test.ts
├── web.schema.test.ts
└── artifact.service.test.ts

test/integration/artifact/
├── migration.int.test.ts
└── artifact.repository.int.test.ts
```

**修改**:

- `src/core/db.ts`:`Database` 类型加 `artifacts: ArtifactRow`
- `src/main.ts`:`buildApp()` 里装配 registry + repository + service(**不挂路由**)
- `README.md`:状态栏加 S3.2 完成标记(可选,Task 14)

---

## Task 0 · 分支确认

**Files:** 无

- [ ] **Step 1: 确认在 `feature/s3-2-artifact-model` 分支,且已有 spec commit**

```bash
git branch --show-current
git log --oneline -3
```

Expected:
```
feature/s3-2-artifact-model
94dfb70 docs(s3.2): artifact model design (platform contract center)
...  (origin/main 上的 commit)
```

如果不在该分支:`git checkout feature/s3-2-artifact-model`。

- [ ] **Step 2: 确认主干是最新**

```bash
git fetch origin && git log --oneline origin/main -1
```

如果 origin/main 比本分支的 parent 还新,`git rebase origin/main`。否则继续。

---

## Task 1 · Database 类型扩展

**Files:**
- Modify: `src/core/db.ts`

- [ ] **Step 1: 在 `MessageRow` 定义之后、`Database` 类型之前,加入 `ArtifactRow`**

```typescript
export type ArtifactRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  payload: unknown;                                              // mysql2 自动 parse JSON
  status: 'ready' | 'retired';
  origin: 'user_intent' | 'iteration' | 'fork' | 'install';
  parent_artifact_id: string | null;
  created_at: Date;
};
```

- [ ] **Step 2: 把 artifacts 加进 `Database` 类型**

```typescript
export type Database = {
  users: UserRow;
  identities: IdentityRow;
  sessions: SessionRow;
  login_attempts: LoginAttemptRow;
  conversations: ConversationRow;
  messages: MessageRow;
  artifacts: ArtifactRow;
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错退出。

- [ ] **Step 4: Commit**

```bash
git add src/core/db.ts
git commit -m "feat(s3.2): extend Database type with artifacts"
```

---

## Task 2 · Migration

**Files:**
- Create: `migrations/20260424_003_init_artifact.ts`

- [ ] **Step 1: 创建 migration 文件**

```typescript
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE artifacts (
      id                  CHAR(26)      NOT NULL,
      user_id             CHAR(26)      NOT NULL,
      kind                VARCHAR(32)   NOT NULL,
      title               VARCHAR(200)  NOT NULL,
      payload             JSON          NOT NULL,
      status              VARCHAR(16)   NOT NULL DEFAULT 'ready',
      origin              VARCHAR(32)   NOT NULL,
      parent_artifact_id  CHAR(26)      NULL,
      created_at          DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_artifacts_user_created (user_id, created_at DESC),
      KEY idx_artifacts_user_kind_status (user_id, kind, status),
      KEY idx_artifacts_parent (parent_artifact_id),
      CONSTRAINT chk_artifacts_status CHECK (status IN ('ready','retired')),
      CONSTRAINT chk_artifacts_origin CHECK (origin IN ('user_intent','iteration','fork','install')),
      CONSTRAINT fk_artifacts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_artifacts_parent FOREIGN KEY (parent_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS artifacts`.execute(db);
}
```

**注意事项**:
- 文件名严格按 `20260424_003_init_artifact.ts`(003 在当前 codebase 连号)
- `kind` **不加** DB CHECK(spec 决策 2/11:应用层 registry 是权威,DB 不限制)
- `status` / `origin` 加 DB CHECK(有限封闭集)
- `parent_artifact_id` ON DELETE SET NULL(允许孤儿节点,保留历史)
- `user_id` ON DELETE CASCADE(用户真删时级联,注意 S1.1 用户是软删所以生产环境不会触发,但 FK 必须正确)
- InnoDB + utf8mb4(对齐 S1.1/S2)

- [ ] **Step 2: 本地执行 migration**

确保 MySQL(3308 端口,容器名 `moon-mysql`)已启动。然后:

```bash
pnpm db:migrate
```

Expected:
```
[up] 20260423_001_init_identity: Success   (已应用过,跳过)
[up] 20260424_002_init_memory: Success   (已应用过,跳过)
[up] 20260424_003_init_artifact: Success
```

- [ ] **Step 3: 回滚再重做,验证 down 可重入**

```bash
pnpm db:rollback
pnpm db:migrate
```

Expected:`down` 删掉 artifacts 表(注意 Kysely 只回滚最后一个 batch,所以只会回滚 003);`up` 重建成功。

- [ ] **Step 4: Commit**

```bash
git add migrations/20260424_003_init_artifact.ts
git commit -m "feat(s3.2): add initial migration (artifacts)"
```

---

## Task 3 · Domain 类型

**Files:**
- Create: `src/modules/artifact/domain/artifact.ts`

- [ ] **Step 1: 创建文件**

```typescript
export type ArtifactKind = string;                                        // 运行时按 registry 校验
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

**为什么 `ArtifactKind = string` 而不是 string literal union**:kind 可扩展(spec 决策 2),未来 M4 加 mcp/skill 等,用 union 会强制每次改 domain 类型。消费方按 kind 收窄 payload 类型(见 registry.test.ts 里 test kind 的用法)。

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/artifact/domain/artifact.ts
git commit -m "feat(s3.2): add artifact domain types and constants"
```

---

## Task 4 · Domain 错误类

**Files:**
- Create: `src/modules/artifact/domain/errors.ts`

- [ ] **Step 1: 创建文件**

```typescript
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

**说明**(spec § 7):虽然 S3.2 无 HTTP,错误类仍继承 AppError —— 未来任何消费方(同进程模块或以后加的 HTTP 层)接到错误后,通过既有 errorHandler 自动转合适响应。零成本维持全平台错误契约一致。

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/artifact/domain/errors.ts
git commit -m "feat(s3.2): add artifact domain errors"
```

---

## Task 5 · Schema Registry

**Files:**
- Create: `src/modules/artifact/registry/index.ts`
- Test: `test/unit/artifact/registry.test.ts`

- [ ] **Step 1: 先写失败测试 `test/unit/artifact/registry.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { InMemoryArtifactSchemaRegistry } from '../../../src/modules/artifact/registry';
import { InvalidPayloadError } from '../../../src/modules/artifact/domain/errors';

// 测试专用 kind + schema,不复用 web.schema,保证 registry 机制测试独立
const testKind = 'test-kind';
const testSchema = z.object({ note: z.string().min(1) });

describe('InMemoryArtifactSchemaRegistry', () => {
  it('register + has', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    expect(r.has(testKind)).toBe(false);
    r.register(testKind, testSchema);
    expect(r.has(testKind)).toBe(true);
  });

  it('listKinds returns all registered kinds', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register('a', testSchema);
    r.register('b', testSchema);
    expect(r.listKinds().sort()).toEqual(['a', 'b']);
  });

  it('registering same kind twice throws', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register(testKind, testSchema);
    expect(() => r.register(testKind, testSchema)).toThrow(/already registered/);
  });

  it('validate returns parsed data for valid payload', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register(testKind, testSchema);
    const data = r.validate(testKind, { note: 'hello' });
    expect(data).toEqual({ note: 'hello' });
  });

  it('validate throws InvalidPayloadError for unknown kind', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    expect(() => r.validate('nope', {})).toThrow(InvalidPayloadError);
  });

  it('validate throws InvalidPayloadError for invalid payload and carries details', () => {
    const r = new InMemoryArtifactSchemaRegistry();
    r.register(testKind, testSchema);
    try {
      r.validate(testKind, { note: '' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPayloadError);
      expect((e as InvalidPayloadError).details).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/artifact/registry.test.ts
```

Expected:FAIL(registry 文件不存在)。

- [ ] **Step 3: 实现 `src/modules/artifact/registry/index.ts`**

```typescript
import type { ZodTypeAny } from 'zod';
import { InvalidPayloadError } from '../domain/errors';
import type { ArtifactKind } from '../domain/artifact';

export interface ArtifactSchemaRegistry {
  register(kind: ArtifactKind, schema: ZodTypeAny): void;
  has(kind: ArtifactKind): boolean;
  validate(kind: ArtifactKind, payload: unknown): unknown;
  listKinds(): ArtifactKind[];
}

export class InMemoryArtifactSchemaRegistry implements ArtifactSchemaRegistry {
  private readonly schemas = new Map<ArtifactKind, ZodTypeAny>();

  register(kind: ArtifactKind, schema: ZodTypeAny): void {
    if (this.schemas.has(kind)) {
      throw new Error(`kind "${kind}" already registered`);
    }
    this.schemas.set(kind, schema);
  }

  has(kind: ArtifactKind): boolean {
    return this.schemas.has(kind);
  }

  validate(kind: ArtifactKind, payload: unknown): unknown {
    const schema = this.schemas.get(kind);
    if (!schema) {
      throw new InvalidPayloadError(`unknown kind: ${kind}`);
    }
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new InvalidPayloadError('payload schema validation failed', result.error.flatten());
    }
    return result.data;
  }

  listKinds(): ArtifactKind[] {
    return [...this.schemas.keys()];
  }
}
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/artifact/registry.test.ts
```

Expected:PASS(6 条)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/artifact/registry/index.ts test/unit/artifact/registry.test.ts
git commit -m "feat(s3.2): schema registry (register/has/validate/listKinds)"
```

---

## Task 6 · Web kind 的 payload schema

**Files:**
- Create: `src/modules/artifact/registry/web.schema.ts`
- Test: `test/unit/artifact/web.schema.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { WebArtifactPayload } from '../../../src/modules/artifact/registry/web.schema';

describe('WebArtifactPayload', () => {
  it('accepts a minimal payload', () => {
    const ok = WebArtifactPayload.parse({
      entryHtml: '<html></html>',
      metadata: {
        generatedBy: 'forge-pipeline-v1',
        generatedAt: '2026-04-24T10:00:00.000Z',
      },
    });
    expect(ok.entryHtml).toBe('<html></html>');
    expect(ok.assets).toBeUndefined();
  });

  it('accepts payload with assets', () => {
    const ok = WebArtifactPayload.parse({
      entryHtml: '<html></html>',
      assets: { 'style.css': 'body{}' },
      metadata: { generatedBy: 'x', generatedAt: '2026-04-24T10:00:00.000Z' },
    });
    expect(ok.assets?.['style.css']).toBe('body{}');
  });

  it('rejects missing entryHtml', () => {
    expect(() => WebArtifactPayload.parse({
      metadata: { generatedBy: 'x', generatedAt: '2026-04-24T10:00:00.000Z' },
    })).toThrow();
  });

  it('rejects empty entryHtml', () => {
    expect(() => WebArtifactPayload.parse({
      entryHtml: '',
      metadata: { generatedBy: 'x', generatedAt: '2026-04-24T10:00:00.000Z' },
    })).toThrow();
  });

  it('rejects non-ISO metadata.generatedAt', () => {
    expect(() => WebArtifactPayload.parse({
      entryHtml: '<html></html>',
      metadata: { generatedBy: 'x', generatedAt: 'not-a-date' },
    })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/artifact/web.schema.test.ts
```

Expected:FAIL(文件不存在)。

- [ ] **Step 3: 实现**

```typescript
import { z } from 'zod';

export const WebArtifactPayload = z.object({
  entryHtml: z.string().min(1),
  assets: z.record(z.string()).optional(),
  metadata: z.object({
    generatedBy: z.string().min(1),
    generatedAt: z.string().datetime(),
  }),
});

export type WebArtifactPayload = z.infer<typeof WebArtifactPayload>;
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/artifact/web.schema.test.ts
```

Expected:PASS(5 条)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/artifact/registry/web.schema.ts test/unit/artifact/web.schema.test.ts
git commit -m "feat(s3.2): web kind payload schema"
```

---

## Task 7 · ArtifactRepository

**Files:**
- Create: `src/modules/artifact/repositories/artifact.repository.ts`

> 这个 Repository 内联 cursor 逻辑(`(created_at, id)` DESC 分页),不复用 memory 的 cursor.ts —— 因为 memory 的 cursor 字段名是 `updated_at`,artifact 用 `created_at`,语义不同。两边各保一份更清晰。
>
> 本 Task 不写 unit(repository 层用 integration 覆盖,见 Task 10)。

- [ ] **Step 1: 创建文件**

```typescript
import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { Artifact, ArtifactKind, ArtifactOrigin, ArtifactStatus } from '../domain/artifact';

type CursorPayload = { t: Date; id: string };

function encodeCursor(p: CursorPayload): string {
  const obj = { t: p.t.toISOString(), id: p.id };
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCursor(s: string): CursorPayload {
  let parsed: unknown;
  try {
    const raw = Buffer.from(s, 'base64url').toString('utf8');
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_CURSOR');
  }
  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof (parsed as Record<string, unknown>).t !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new Error('INVALID_CURSOR');
  }
  const { t, id } = parsed as { t: string; id: string };
  const date = new Date(t);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_CURSOR');
  return { t: date, id };
}

function rowToArtifact(row: {
  id: string; user_id: string; kind: string; title: string; payload: unknown;
  status: 'ready' | 'retired';
  origin: 'user_intent' | 'iteration' | 'fork' | 'install';
  parent_artifact_id: string | null;
  created_at: Date;
}): Artifact {
  // mysql2 returns JSON columns already parsed (object), but some edge cases
  // (e.g., older connector versions) return a string. Normalize defensively.
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    payload,
    status: row.status,
    origin: row.origin,
    parentArtifactId: row.parent_artifact_id,
    createdAt: row.created_at,
  };
}

export class ArtifactRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(a: {
    id: string;
    userId: string;
    kind: ArtifactKind;
    title: string;
    payload: unknown;
    status: ArtifactStatus;
    origin: ArtifactOrigin;
    parentArtifactId: string | null;
    now: Date;
  }): Promise<void> {
    // Kysely does NOT auto-stringify for JSON columns; mysql2 would send
    // "[object Object]" unless we stringify first.
    await this.db.insertInto('artifacts').values({
      id: a.id,
      user_id: a.userId,
      kind: a.kind,
      title: a.title,
      payload: JSON.stringify(a.payload) as unknown,   // cast because column type is `unknown`
      status: a.status,
      origin: a.origin,
      parent_artifact_id: a.parentArtifactId,
      created_at: a.now,
    }).execute();
  }

  async findById(id: string): Promise<Artifact | null> {
    const row = await this.db.selectFrom('artifacts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? rowToArtifact(row) : null;
  }

  async listByUser(userId: string, opts: {
    limit: number;
    cursor?: string | null;
    kind?: ArtifactKind;
    status?: ArtifactStatus;
  }): Promise<{ items: Artifact[]; nextCursor: string | null }> {
    let query = this.db.selectFrom('artifacts')
      .selectAll()
      .where('user_id', '=', userId);

    if (opts.kind !== undefined) {
      query = query.where('kind', '=', opts.kind);
    }
    if (opts.status !== undefined) {
      query = query.where('status', '=', opts.status);
    }
    if (opts.cursor) {
      const { t, id } = decodeCursor(opts.cursor);
      // (created_at, id) < (cursor.t, cursor.id) for DESC pagination
      query = query.where((eb) => eb.or([
        eb('created_at', '<', t),
        eb.and([eb('created_at', '=', t), eb('id', '<', id)]),
      ]));
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit + 1)
      .execute();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(rowToArtifact);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.createdAt, id: last.id })
      : null;

    return { items, nextCursor };
  }

  async updateStatus(id: string, status: ArtifactStatus): Promise<void> {
    await this.db.updateTable('artifacts')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }
}
```

**关键点**:
- `JSON.stringify(a.payload) as unknown`:`artifacts.payload` 的 `ArtifactRow` 类型是 `unknown`,Kysely 推出 insert values 的类型也是 `unknown`。传 JSON 字符串匹配 mysql2 driver 的"期望 string"行为
- `rowToArtifact` 里**防御性 parse**:mysql2 新版本读 JSON 列自动 parse,但不同 driver 版本行为不一致,加 `typeof === 'string'` 兜底
- `listByUser` 的 cursor 方向:**DESC**(最新在前),和 S2 conversations 的 DESC 一致,但字段是 `created_at`(spec § 2 + § 4)

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/artifact/repositories/artifact.repository.ts
git commit -m "feat(s3.2): ArtifactRepository (insert/find/list/updateStatus)"
```

---

## Task 8 · ArtifactService(TDD:骨架 + create)

**Files:**
- Create: `src/modules/artifact/services/artifact.service.ts`
- Test: `test/unit/artifact/artifact.service.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import { InMemoryArtifactSchemaRegistry } from '../../../src/modules/artifact/registry';
import {
  ArtifactNotFoundError,
  ArtifactForbiddenError,
  InvalidPayloadError,
} from '../../../src/modules/artifact/domain/errors';
import type { Artifact } from '../../../src/modules/artifact/domain/artifact';

const testKind = 'test-kind';
const testSchema = z.object({ note: z.string().min(1) });

function makeRegistry(): InMemoryArtifactSchemaRegistry {
  const r = new InMemoryArtifactSchemaRegistry();
  r.register(testKind, testSchema);
  return r;
}

function makeRepoMock() {
  return {
    insert: vi.fn(async () => {}),
    findById: vi.fn(),
    listByUser: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateStatus: vi.fn(async () => {}),
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: '01K40A8Y3V9E2XBSG5HMTVKQ11',
    userId: '01K40A8Y3V9E2XBSG5HMTVKQ22',
    kind: testKind,
    title: 'hi',
    payload: { note: 'hi' },
    status: 'ready',
    origin: 'user_intent',
    parentArtifactId: null,
    createdAt: new Date('2026-04-24T10:00:00.000Z'),
    ...overrides,
  };
}

describe('ArtifactService.create', () => {
  it('validates payload via registry and inserts with defaults', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    const r = await service.create('user1', {
      kind: testKind,
      title: 'my artifact',
      payload: { note: 'hello' },
      origin: 'user_intent',
    });
    expect(repo.insert).toHaveBeenCalledOnce();
    const arg = repo.insert.mock.calls[0][0];
    expect(arg.userId).toBe('user1');
    expect(arg.title).toBe('my artifact');
    expect(arg.status).toBe('ready');
    expect(arg.origin).toBe('user_intent');
    expect(arg.parentArtifactId).toBeNull();
    expect(arg.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(r.userId).toBe('user1');
    expect(r.status).toBe('ready');
  });

  it('throws InvalidPayloadError when payload fails validation; insert is NOT called', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.create('user1', {
      kind: testKind,
      title: 'x',
      payload: { note: '' },
      origin: 'user_intent',
    })).rejects.toBeInstanceOf(InvalidPayloadError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('throws InvalidPayloadError for unknown kind', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.create('user1', {
      kind: 'never-registered',
      title: 'x',
      payload: {},
      origin: 'user_intent',
    })).rejects.toBeInstanceOf(InvalidPayloadError);
  });

  it('with parentArtifactId: checks parent exists; fails when missing', async () => {
    const repo = makeRepoMock();
    repo.findById.mockResolvedValueOnce(null);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.create('user1', {
      kind: testKind,
      title: 'x',
      payload: { note: 'hi' },
      origin: 'iteration',
      parentArtifactId: '01K40A8Y3V9E2XBSG5HMTVKQZZ',
    })).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('with parentArtifactId pointing to ANOTHER user: does NOT throw (fork is allowed)', async () => {
    const repo = makeRepoMock();
    const parent = makeArtifact({ userId: 'someone-else' });
    repo.findById.mockResolvedValueOnce(parent);
    const service = new ArtifactService(repo as any, makeRegistry());
    const r = await service.create('user1', {
      kind: testKind,
      title: 'fork of something',
      payload: { note: 'hi' },
      origin: 'fork',
      parentArtifactId: parent.id,
    });
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(r.userId).toBe('user1');
    expect(r.parentArtifactId).toBe(parent.id);
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/artifact/artifact.service.test.ts
```

Expected:FAIL(service 文件不存在)。

- [ ] **Step 3: 实现 service 骨架 + create**

```typescript
import { ulid } from 'ulid';
import type {
  Artifact, ArtifactKind, ArtifactOrigin, ArtifactStatus,
} from '../domain/artifact';
import {
  ArtifactNotFoundError,
  ArtifactForbiddenError,
} from '../domain/errors';
import type { ArtifactRepository } from '../repositories/artifact.repository';
import type { ArtifactSchemaRegistry } from '../registry';

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

  async create(userId: string, input: CreateArtifactInput): Promise<Artifact> {
    // 1. registry validate;失败抛 InvalidPayloadError
    this.registry.validate(input.kind, input.payload);

    // 2. parent 存在性(不查归属,fork 场景允许跨用户)
    const parentArtifactId = input.parentArtifactId ?? null;
    if (parentArtifactId !== null) {
      const parent = await this.artifacts.findById(parentArtifactId);
      if (!parent) throw new ArtifactNotFoundError();
    }

    // 3. insert
    const id = ulid();
    const now = new Date();
    const status: ArtifactStatus = 'ready';
    await this.artifacts.insert({
      id,
      userId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      status,
      origin: input.origin,
      parentArtifactId,
      now,
    });

    return {
      id,
      userId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      status,
      origin: input.origin,
      parentArtifactId,
      createdAt: now,
    };
  }

  // getById / listByUser / retire 下一 Task 加
}
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/artifact/artifact.service.test.ts
```

Expected:PASS(5 条 `describe('ArtifactService.create')` 下的)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/artifact/services/artifact.service.ts test/unit/artifact/artifact.service.test.ts
git commit -m "feat(s3.2): ArtifactService create (validate + parent check + insert)"
```

---

## Task 9 · ArtifactService · getById / listByUser / retire

**Files:**
- Modify: `src/modules/artifact/services/artifact.service.ts`
- Modify: `test/unit/artifact/artifact.service.test.ts`

- [ ] **Step 1: 追加测试到同一文件末尾**

```typescript
describe('ArtifactService.getById', () => {
  it('returns when owned by user', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'user1' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    const r = await service.getById('user1', a.id);
    expect(r.id).toBe(a.id);
  });

  it('throws ArtifactNotFoundError when id unknown', async () => {
    const repo = makeRepoMock();
    repo.findById.mockResolvedValueOnce(null);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.getById('user1', 'missing')).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it('throws ArtifactForbiddenError when owned by another user', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'other' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.getById('user1', a.id)).rejects.toBeInstanceOf(ArtifactForbiddenError);
  });
});

describe('ArtifactService.listByUser', () => {
  it('defaults status to ready when not provided', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.listByUser('user1', { limit: 20 });
    expect(repo.listByUser).toHaveBeenCalledWith('user1', {
      limit: 20,
      cursor: undefined,
      kind: undefined,
      status: 'ready',
    });
  });

  it('passes explicit status through (allow querying retired)', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.listByUser('user1', { limit: 20, status: 'retired' });
    expect(repo.listByUser.mock.calls[0][1].status).toBe('retired');
  });

  it('passes kind + cursor through', async () => {
    const repo = makeRepoMock();
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.listByUser('user1', { limit: 10, kind: 'web', cursor: 'abc' });
    expect(repo.listByUser.mock.calls[0][1]).toMatchObject({
      limit: 10, kind: 'web', cursor: 'abc', status: 'ready',
    });
  });
});

describe('ArtifactService.retire', () => {
  it('retires when owned and currently ready', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'user1', status: 'ready' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.retire('user1', a.id);
    expect(repo.updateStatus).toHaveBeenCalledWith(a.id, 'retired');
  });

  it('is idempotent when already retired (does NOT call updateStatus)', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'user1', status: 'retired' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await service.retire('user1', a.id);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('throws ArtifactForbiddenError when owned by another user', async () => {
    const repo = makeRepoMock();
    const a = makeArtifact({ userId: 'other', status: 'ready' });
    repo.findById.mockResolvedValueOnce(a);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.retire('user1', a.id)).rejects.toBeInstanceOf(ArtifactForbiddenError);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('throws ArtifactNotFoundError when id unknown', async () => {
    const repo = makeRepoMock();
    repo.findById.mockResolvedValueOnce(null);
    const service = new ArtifactService(repo as any, makeRegistry());
    await expect(service.retire('user1', 'missing')).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/artifact/artifact.service.test.ts
```

Expected:FAIL(新方法不存在)。

- [ ] **Step 3: 在 ArtifactService 里补三个方法**

在 `create` 之后、类结束之前插入:

```typescript
  async getById(userId: string, id: string): Promise<Artifact> {
    const a = await this.artifacts.findById(id);
    if (!a) throw new ArtifactNotFoundError();
    if (a.userId !== userId) throw new ArtifactForbiddenError();
    return a;
  }

  async listByUser(userId: string, opts: ListArtifactsOptions): Promise<{ items: Artifact[]; nextCursor: string | null }> {
    // status 默认只查 ready(见 spec § 6)
    return this.artifacts.listByUser(userId, {
      limit: opts.limit,
      cursor: opts.cursor,
      kind: opts.kind,
      status: opts.status ?? 'ready',
    });
  }

  async retire(userId: string, id: string): Promise<void> {
    const a = await this.getById(userId, id);           // 复用归属校验
    if (a.status === 'retired') return;                  // 幂等
    await this.artifacts.updateStatus(id, 'retired');
  }
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit
```

Expected:整个 unit 套件 PASS(S1.1 11 + memory + artifact 新增)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/artifact/services/artifact.service.ts test/unit/artifact/artifact.service.test.ts
git commit -m "feat(s3.2): ArtifactService getById + listByUser + retire"
```

---

## Task 10 · Integration:migration

**Files:**
- Create: `test/integration/artifact/migration.int.test.ts`

参考 `test/integration/memory/migration.int.test.ts`(已存在)作为结构模板。

- [ ] **Step 1: 创建文件**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let cleanup: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.destroy;

  // seed a user for FK tests
  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `art-mig-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Art Mig',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('artifact migration', () => {
  it('creates artifacts table with expected columns', async () => {
    const rows = await sql<{ COLUMN_NAME: string }>`
      SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'artifacts'
    `.execute(db);
    const names = rows.rows.map((r) => r.COLUMN_NAME);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'user_id', 'kind', 'title', 'payload',
      'status', 'origin', 'parent_artifact_id', 'created_at',
    ]));
  });

  it('has CHECK constraint on status', async () => {
    const rows = await sql<{ CONSTRAINT_NAME: string }>`
      SELECT CONSTRAINT_NAME FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'chk_artifacts_status'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('has CHECK constraint on origin', async () => {
    const rows = await sql<{ CONSTRAINT_NAME: string }>`
      SELECT CONSTRAINT_NAME FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'chk_artifacts_origin'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('rejects invalid status via CHECK', async () => {
    const artId = ulid();
    await expect(sql`
      INSERT INTO artifacts (id, user_id, kind, title, payload, status, origin, created_at)
      VALUES (${artId}, ${userId}, 'web', 'x', JSON_OBJECT('a', 1), 'invalid', 'user_intent', NOW(3))
    `.execute(db)).rejects.toThrow();
  });

  it('rejects invalid origin via CHECK', async () => {
    const artId = ulid();
    await expect(sql`
      INSERT INTO artifacts (id, user_id, kind, title, payload, status, origin, created_at)
      VALUES (${artId}, ${userId}, 'web', 'x', JSON_OBJECT('a', 1), 'ready', 'invalid-origin', NOW(3))
    `.execute(db)).rejects.toThrow();
  });

  it('accepts ANY kind value (no DB CHECK on kind)', async () => {
    const artId = ulid();
    await expect(sql`
      INSERT INTO artifacts (id, user_id, kind, title, payload, status, origin, created_at)
      VALUES (${artId}, ${userId}, 'some-weird-kind', 'x', JSON_OBJECT('a', 1), 'ready', 'user_intent', NOW(3))
    `.execute(db)).resolves.toBeDefined();
    await db.deleteFrom('artifacts').where('id', '=', artId).execute();   // cleanup
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test:integration test/integration/artifact/migration.int.test.ts
```

Expected:PASS 6 条。

- [ ] **Step 3: Commit**

```bash
git add test/integration/artifact/migration.int.test.ts
git commit -m "test(s3.2): migration integration (schema + CHECK constraints)"
```

---

## Task 11 · Integration:ArtifactRepository

**Files:**
- Create: `test/integration/artifact/artifact.repository.int.test.ts`

参考 `test/integration/memory/conversation.repository.int.test.ts` 作为结构模板。

- [ ] **Step 1: 创建文件**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let repo: ArtifactRepository;
let cleanup: () => Promise<void>;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  repo = new ArtifactRepository(db);
  cleanup = ctx.destroy;

  userId = ulid();
  otherUserId = ulid();
  for (const [id, suffix] of [[userId, 'a'], [otherUserId, 'b']] as const) {
    await db.insertInto('users').values({
      id,
      email: `art-${suffix}-${id}@example.com`,
      email_verified: 0,
      password_hash: 'irrelevant',
      display_name: `Art ${suffix}`,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();
  }
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('artifacts').where('user_id', 'in', [userId, otherUserId]).execute();
  await db.deleteFrom('users').where('id', 'in', [userId, otherUserId]).execute();
  await cleanup();
});

beforeEach(async () => {
  await db.deleteFrom('artifacts').where('user_id', 'in', [userId, otherUserId]).execute();
});

describe('ArtifactRepository', () => {
  it('inserts and findById round-trips (incl JSON payload)', async () => {
    const id = ulid();
    const now = new Date('2026-04-24T10:00:00.000Z');
    await repo.insert({
      id, userId, kind: 'web', title: 't',
      payload: { entryHtml: '<x/>', nested: { k: 1 } },
      status: 'ready', origin: 'user_intent',
      parentArtifactId: null, now,
    });

    const back = await repo.findById(id);
    expect(back).not.toBeNull();
    expect(back!.userId).toBe(userId);
    expect(back!.kind).toBe('web');
    expect(back!.status).toBe('ready');
    expect(back!.origin).toBe('user_intent');
    expect(back!.parentArtifactId).toBeNull();
    expect(back!.payload).toEqual({ entryHtml: '<x/>', nested: { k: 1 } });
  });

  it('listByUser returns only the requested user in DESC created_at order', async () => {
    const baseTs = Date.now();
    const idA = ulid(), idB = ulid(), idOther = ulid();
    await repo.insert({ id: idA, userId, kind: 'web', title: 'A', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null,
      now: new Date(baseTs) });
    await repo.insert({ id: idB, userId, kind: 'web', title: 'B', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null,
      now: new Date(baseTs + 1000) });
    await repo.insert({ id: idOther, userId: otherUserId, kind: 'web', title: 'X', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null,
      now: new Date(baseTs + 2000) });

    const r = await repo.listByUser(userId, { limit: 10 });
    expect(r.items.map((a) => a.title)).toEqual(['B', 'A']);
    expect(r.nextCursor).toBeNull();
  });

  it('listByUser filters by kind', async () => {
    await repo.insert({ id: ulid(), userId, kind: 'web', title: 'w', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.insert({ id: ulid(), userId, kind: 'mcp', title: 'm', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });

    const r = await repo.listByUser(userId, { limit: 10, kind: 'web' });
    expect(r.items.length).toBe(1);
    expect(r.items[0].kind).toBe('web');
  });

  it('listByUser filters by status', async () => {
    await repo.insert({ id: ulid(), userId, kind: 'web', title: 'R', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.insert({ id: ulid(), userId, kind: 'web', title: 'X', payload: {},
      status: 'retired', origin: 'user_intent', parentArtifactId: null, now: new Date() });

    const r = await repo.listByUser(userId, { limit: 10, status: 'retired' });
    expect(r.items.length).toBe(1);
    expect(r.items[0].title).toBe('X');
  });

  it('listByUser paginates via cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.insert({ id: ulid(), userId, kind: 'web', title: `c${i}`,
        payload: {}, status: 'ready', origin: 'user_intent',
        parentArtifactId: null, now: new Date(Date.now() + i * 1000) });
    }
    const p1 = await repo.listByUser(userId, { limit: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await repo.listByUser(userId, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.length).toBe(2);

    const ids1 = new Set(p1.items.map((a) => a.id));
    for (const a of p2.items) expect(ids1.has(a.id)).toBe(false);

    const p3 = await repo.listByUser(userId, { limit: 2, cursor: p2.nextCursor });
    expect(p3.items.length).toBe(1);
    expect(p3.nextCursor).toBeNull();
  });

  it('updateStatus changes status', async () => {
    const id = ulid();
    await repo.insert({ id, userId, kind: 'web', title: 't', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.updateStatus(id, 'retired');
    const back = await repo.findById(id);
    expect(back!.status).toBe('retired');
  });

  it('FK user ON DELETE CASCADE: hard-deleting user cascades to artifacts', async () => {
    const throwawayUser = ulid();
    await db.insertInto('users').values({
      id: throwawayUser,
      email: `art-cascade-${throwawayUser}@example.com`,
      email_verified: 0, password_hash: 'x', display_name: 'Cascade',
      status: 'active', created_at: new Date(), updated_at: new Date(),
    }).execute();
    const artId = ulid();
    await repo.insert({ id: artId, userId: throwawayUser, kind: 'web', title: 'c',
      payload: {}, status: 'ready', origin: 'user_intent',
      parentArtifactId: null, now: new Date() });

    await db.deleteFrom('users').where('id', '=', throwawayUser).execute();

    const after = await repo.findById(artId);
    expect(after).toBeNull();
  });

  it('FK parent ON DELETE SET NULL: deleting parent nulls child.parent_artifact_id', async () => {
    const parentId = ulid();
    const childId = ulid();
    await repo.insert({ id: parentId, userId, kind: 'web', title: 'P', payload: {},
      status: 'ready', origin: 'user_intent', parentArtifactId: null, now: new Date() });
    await repo.insert({ id: childId, userId, kind: 'web', title: 'C', payload: {},
      status: 'ready', origin: 'iteration', parentArtifactId: parentId, now: new Date() });

    // hard delete parent directly(绕过 service)
    await db.deleteFrom('artifacts').where('id', '=', parentId).execute();

    const child = await repo.findById(childId);
    expect(child).not.toBeNull();
    expect(child!.parentArtifactId).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test:integration test/integration/artifact/artifact.repository.int.test.ts
```

Expected:PASS 8 条。

**如果 JSON payload round-trip 失败**:说明 mysql2 版本/配置不会自动 parse JSON。查 `rowToArtifact` 的兜底逻辑(Task 7)是否生效;如仍失败,可能需要在 `insert` 里调整(比如传原对象而非 stringify) —— 这是**mysql2 版本相关的配置问题**,不是 plan 设计问题,按实际情况调整。

- [ ] **Step 3: Commit**

```bash
git add test/integration/artifact/artifact.repository.int.test.ts
git commit -m "test(s3.2): repository integration (CRUD + filter + cursor + FK)"
```

---

## Task 12 · 装配进 main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 追加 import**

在 `import { buildMemoryRoutes } from './modules/memory/routes';` 之后追加:

```typescript
import { InMemoryArtifactSchemaRegistry } from './modules/artifact/registry';
import { WebArtifactPayload } from './modules/artifact/registry/web.schema';
import { ArtifactRepository } from './modules/artifact/repositories/artifact.repository';
import { ArtifactService } from './modules/artifact/services/artifact.service';
```

- [ ] **Step 2: 在 buildApp() 里装配 artifact 模块**

找到 memory 装配之后的行(`const memoryController = new MemoryController(memoryService);` 附近),在 memory 装配块的**最后一行**之后插入:

```typescript
  // S3.2 artifact module (no HTTP routes; exposed as in-process service for M2+ subsystems)
  const artifactRegistry = new InMemoryArtifactSchemaRegistry();
  artifactRegistry.register('web', WebArtifactPayload);

  const artifactRepo = new ArtifactRepository(db);
  const artifactService = new ArtifactService(artifactRepo, artifactRegistry);

  // artifactService intentionally not used yet — it's the contract center
  // that future S3.1/S3.3/S3.4/S4.1 will consume. Reference it once to avoid
  // TS6133 "declared but never used".
  void artifactService;
```

**说明 `void artifactService`**:spec 决策 8 明确 S3.2 无 HTTP、无 controller,M2 其他子系统(S3.1/S3.3/S3.4)**还没开发**,artifactService 这个变量在本阶段确实无消费方。`void` 表达式让 TS 不报 "unused variable"。未来第一个消费方出现时这行删掉。

- [ ] **Step 3: Typecheck + 起服务冒烟**

```bash
pnpm typecheck
```

Expected:无报错。

```bash
pnpm dev
```

服务应该能正常起(端口沿用 .env,日志出现 `server_started`)。由于没挂 artifact 路由,`/api/artifacts` 这种路径会 404 —— 这是**预期行为**。Ctrl-C 停止。

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(s3.2): wire artifact module into main.ts (service-only, no routes)"
```

---

## Task 13 · 跑全量测试 + typecheck

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

Expected:PASS。artifact 新增约 19 条(registry 6 + web.schema 5 + service 5+7=12)+ 既有 S1.1/S2 的全部通过。

- [ ] **Step 3: 全量 integration**

```bash
pnpm test:integration
```

Expected:PASS。artifact 新增 6 + 8 = 14 条 + 既有通过。**注意每个 integration 测试文件启一个独立 MySQL 容器,总体会比较慢(分钟级)**。

- [ ] **Step 4: 全量 e2e**

```bash
pnpm test:e2e
```

Expected:S1.1 + S2 既有 e2e PASS(S3.2 无新 e2e)。

- [ ] **Step 5: 无 commit 必要,全绿直接进入 Task 14**

---

## Task 14 · README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在"当前状态"章节列表里追加 S3.2 完成标记**

找到现有:

```markdown
## 当前状态

- M0 地基:S1.1 账户与身份 ✅(仅一个账号,走 CLI 创建)
- M1 记忆骨架:S2.1 记忆存储 + S2.4 回忆 API ✅(对话文本存取,无内容搜索)
```

在其后追加一行:

```markdown
- M2 平台契约:S3.2 产物模型 ✅(平台契约中心,无 HTTP,供未来 M2 子系统 import)
```

(实际 README 格式按当前文件内容为准,保持一致即可)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(s3.2): mark S3.2 complete in README"
```

---

## Task 15 · 分支收尾

**Files:** 无

- [ ] **Step 1: 检查 commit 结构**

```bash
git log --oneline main..HEAD
```

Expected:约 14 条 commit,feat/test/docs 前缀清晰,按 Task 顺序。

- [ ] **Step 2: working tree 干净**

```bash
git status
```

Expected:`nothing to commit, working tree clean`。

- [ ] **Step 3: 报告给用户**

- 分支:`feature/s3-2-artifact-model`,未合并到 main,未推送
- 新增:migration、`src/modules/artifact/` 完整模块、unit + integration 两档测试、main.ts 装配
- 下一步由用户决定:推送 → merge → 进入下一子系统(M2 里的 S3.1 意图捕获 / S3.3 流水线 / S3.4 运行时 / S4.1 网页形态,顺序由用户定)

---

## Self-Review 记录

plan 写完后做过以下检查:

1. **Spec 覆盖**(按 spec 章节):
   - § 1 目标 → Task 3-12 整体交付
   - § 2 决策表 11 项 → 都在对应 Task 落地(决策 1 骨架 Task 2, 决策 2 payload+registry Task 5+7, 决策 3 只 web Task 6+12, 决策 4 版本嵌入 Task 2 无 updated_at, 决策 5 origin ENUM Task 2 CHECK, 决策 6 归属 Task 2 FK, 决策 7 status Task 2 CHECK, 决策 8 无 HTTP Task 12, 决策 9 测试 Task 5-11, 决策 10 文件组织 见"文件结构"段, 决策 11 方法 Task 8-9)
   - § 3 架构/目录 → 见"文件结构"段
   - § 4 数据模型 → Task 1 + Task 2
   - § 5 Schema Registry → Task 5 + Task 6
   - § 6 Service/Repository → Task 7 + Task 8 + Task 9
   - § 7 错误处理 → Task 4
   - § 8 测试策略 → Task 5/6/8/9 (unit) + Task 10/11 (integration)
   - § 9 非功能性 → 贯穿(索引 Task 2, JSON 日志规避未显式在代码里,由未来消费方承担)
   - § 10 连接点 → Task 12
   - § 11 实现顺序 → Task 顺序对齐

2. **类型一致性**:
   - `ArtifactService` 构造器 2 参数(artifacts + registry),贯穿 Task 8-9 + Task 12
   - `Artifact` 类型 Task 3 定义,后续所有 mock/test 签名一致(userId/kind/title/payload/status/origin/parentArtifactId/createdAt)
   - Repository `insert` 参数字段对齐 Task 7 定义:id/userId/kind/title/payload/status/origin/parentArtifactId/now
   - `listByUser` 的 opts 形状在 Task 7/9/11 一致:`{ limit, cursor?, kind?, status? }`
   - Service 默认 `status = 'ready'` 在 Task 9 实现与 Task 9 测试 `'defaults status to ready'` 对齐

3. **Placeholder 扫描**:无 "TBD/TODO/implement later/fill in" 等;每个 code step 都给出完整代码;每个命令都有 expected 输出;Task 11 的 JSON 行为说明了"如失败怎么处理",不是遗留待办而是明确 mysql2 配置相关兜底。

---

**plan 写完**。交付物清单(实施完成后):
- ✅ Migration `20260424_003_init_artifact.ts`
- ✅ `src/modules/artifact/` 全模块(domain + registry + repository + service)
- ✅ 19 单测 + 14 集成测试(不新增 e2e)
- ✅ main.ts 装配(service-only, 无路由)
- ✅ README 更新
