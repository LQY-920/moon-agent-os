# S2 Memory Core (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 moon-agent-os 加一个用户级统一记忆中枢最小版(M1:S2.1 + S2.4),让用户能通过 HTTP 存/读/删对话,同时提供同进程 Service 供未来 S3.x 模块直接调用。

**Architecture:** 新增 `src/modules/memory/` 模块,结构照搬 S1.1 identity。双表 `conversations` + `messages`,硬绑定 `user_id`,复用 S1.1 的 `requireSession` 鉴权、`AppError`/`errorHandler` 错误链路、Kysely + MySQL 8 数据层。`addMessage` 用事务同步更新 `conversations.updated_at`。

**Tech Stack:** TypeScript / Express 5 / Kysely / MySQL 8 / zod / ULID / vitest / supertest / testcontainers。全部沿用 S1.1 已有依赖,不新增 npm 包。

**Spec:** `docs/superpowers/specs/2026-04-23-s2-memory-core-design.md`

**分支:** `feature/s2-memory-core`(已创建,由 brainstorming 提交了 spec)

---

## 已对齐的 spec 修正

实现前先对齐两处 spec 与现有代码的表达差异,后续 Task 按"现有代码为准":

1. **错误响应结构**:spec § 4 写的是 `{ "code": "...", "message": "..." }`,实际 errorHandler 产出 `{ "error": { "code, message, details? } }`。以**实际为准**,所有 e2e 断言按 `body.error.code` 写
2. **`req.user`**:spec § 7 提到"`req.user.id`",实际 `requireSession` 注入 `res.locals.auth: { userId, sessionId }`。以**实际为准**

Task 22 会统一修回 spec。

---

## 文件结构

**新增**:

```
migrations/
└── 20260424_002_init_memory.ts                 # 双表 + 索引

src/modules/memory/
├── routes.ts                                    # buildMemoryRoutes(opts)
├── schema.ts                                    # zod schema 平铺一文件
├── controllers/
│   └── memory.controller.ts                    # MemoryController 类
├── services/
│   └── memory.service.ts                       # MemoryService 类
├── repositories/
│   ├── conversation.repository.ts
│   └── message.repository.ts
└── domain/
    ├── conversation.ts                          # Conversation 类型
    ├── message.ts                               # Message + MessageRole 类型
    └── errors.ts                                # ConversationNotFoundError, ConversationForbiddenError

test/unit/memory/
├── memory.service.test.ts
└── schema.test.ts

test/integration/memory/
├── conversation.repository.int.test.ts
├── message.repository.int.test.ts
└── migration.int.test.ts

test/e2e/
└── memory.e2e.test.ts

docs/qa/
└── s2-memory-manual-checklist.md
```

**修改**:

- `src/core/db.ts`:`Database` 类型加 `conversations` / `messages` 两张表的 Row 类型
- `src/main.ts`:`buildApp()` 里装配 MemoryRepo/Service/Controller + 挂 `/api/memory` 路由
- `README.md`:状态栏加 M1 完成标记

---

## Task 0 · 分支准备

**Files:** 无(分支已由 brainstorming 阶段创建并提交了 spec)

- [ ] **Step 1: 确认在 feature/s2-memory-core 分支**

```bash
git branch --show-current
```

Expected:
```
feature/s2-memory-core
```

- [ ] **Step 2: 确认 main 已拉到最新(从分支 rebase 避免落后)**

```bash
git fetch origin && git log --oneline origin/main -1
```

Expected:最新 commit 是 `9b32405 docs(qa): s1.1 smoke report 2026-04-23`(或更新的主干)。若 main 有新提交,`git rebase origin/main`。

- [ ] **Step 3: 确认 spec 已在分支**

```bash
git log --oneline -3
```

Expected:应看到 `docs(s2): M1 memory core design` 这条 commit。

---

## Task 1 · Database 类型扩展

**Files:**
- Modify: `src/core/db.ts`

- [ ] **Step 1: 打开 `src/core/db.ts`,在现有 Row 类型下方加两个新 Row 类型**

在 `LoginAttemptRow` 定义之后、`Database` 类型定义之前,插入:

```typescript
export type ConversationRow = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  created_at: Date;
};
```

- [ ] **Step 2: 把两张表加进 `Database` 类型**

```typescript
export type Database = {
  users: UserRow;
  identities: IdentityRow;
  sessions: SessionRow;
  login_attempts: LoginAttemptRow;
  conversations: ConversationRow;
  messages: MessageRow;
};
```

- [ ] **Step 3: 跑 typecheck 确保没破坏**

```bash
pnpm typecheck
```

Expected:无报错退出。

- [ ] **Step 4: Commit**

```bash
git add src/core/db.ts
git commit -m "feat(s2): extend Database type with conversations + messages"
```

---

## Task 2 · Migration

**Files:**
- Create: `migrations/20260424_002_init_memory.ts`

- [ ] **Step 1: 创建 migration 文件,内容如下**

```typescript
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE conversations (
      id           CHAR(26)      NOT NULL,
      user_id      CHAR(26)      NOT NULL,
      title        VARCHAR(200)  NULL,
      created_at   DATETIME(3)   NOT NULL,
      updated_at   DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_conversations_user_updated (user_id, updated_at DESC),
      CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE messages (
      id              CHAR(26)      NOT NULL,
      conversation_id CHAR(26)      NOT NULL,
      role            VARCHAR(16)   NOT NULL,
      content         TEXT          NOT NULL,
      created_at      DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_messages_conversation_created (conversation_id, created_at),
      CONSTRAINT chk_messages_role CHECK (role IN ('user','ai','system')),
      CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS messages`.execute(db);
  await sql`DROP TABLE IF EXISTS conversations`.execute(db);
}
```

**注意事项**:
- 文件名必须是 `20260424_002_init_memory.ts`(顺序号递增,S1.1 是 `001`)
- 两张表都用 InnoDB + utf8mb4,对齐 S1.1
- `created_at` / `updated_at` 不加 `DEFAULT CURRENT_TIMESTAMP(3)` —— S1.1 统一由应用层(`new Date()`)提供,我们保持一致
- `role` 用 CHECK 约束而非 ENUM,便于未来加值
- FK 双向 CASCADE:`conversations.user_id` → `users.id` CASCADE;`messages.conversation_id` → `conversations.id` CASCADE

- [ ] **Step 2: 手工执行 migration 验证**

先确保本地 MySQL 启动(见 README,容器名 `moon-mysql`,端口 3308)。然后:

```bash
pnpm db:migrate
```

Expected:
```
[up] 20260423_001_init_identity: Success   (已应用过会跳过)
[up] 20260424_002_init_memory: Success
```

- [ ] **Step 3: 回滚再重做一次,验证 down 可重入**

```bash
pnpm db:rollback
pnpm db:migrate
```

Expected:`down` 删掉 memory 两张表(注意 identity 表也会被 rollback,`migrateDown` 只回滚最后一个 batch,实际只会回滚 memory);`up` 重建成功。

- [ ] **Step 4: Commit**

```bash
git add migrations/20260424_002_init_memory.ts
git commit -m "feat(s2): add initial migration (conversations + messages)"
```

---

## Task 3 · Domain 类型

**Files:**
- Create: `src/modules/memory/domain/conversation.ts`
- Create: `src/modules/memory/domain/message.ts`

- [ ] **Step 1: 创建 `src/modules/memory/domain/conversation.ts`**

```typescript
export type Conversation = {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 2: 创建 `src/modules/memory/domain/message.ts`**

```typescript
export type MessageRole = 'user' | 'ai' | 'system';

export const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'ai', 'system'] as const;

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};
```

`MESSAGE_ROLES` 在 schema 和 repository 层都会用到,单点定义避免字面量重复。

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 4: Commit**

```bash
git add src/modules/memory/domain/
git commit -m "feat(s2): add memory domain types (Conversation/Message)"
```

---

## Task 4 · Domain 错误类

**Files:**
- Create: `src/modules/memory/domain/errors.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { AppError } from '../../../core/errors';

export class ConversationNotFoundError extends AppError {
  readonly code = 'CONVERSATION_NOT_FOUND';
  readonly status = 404;
  constructor() { super('会话不存在'); }
}

export class ConversationForbiddenError extends AppError {
  readonly code = 'CONVERSATION_FORBIDDEN';
  readonly status = 403;
  constructor() { super('无权访问该会话'); }
}
```

**不加 `InvalidMessageRoleError`**:zod schema 会把非法 role 挡在 controller 之外,业务层不会见到非法值,兜底错误是 dead code,YAGNI 删除。Design § 4 的错误码清单里也一并移除(Task 22 修)。

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/memory/domain/errors.ts
git commit -m "feat(s2): add memory domain errors (NotFound/Forbidden)"
```

---

## Task 5 · zod Schema

**Files:**
- Create: `src/modules/memory/schema.ts`
- Test: `test/unit/memory/schema.test.ts`

- [ ] **Step 1: 先写失败的测试 `test/unit/memory/schema.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  CreateConversationInput,
  AddMessageInput,
  ListConversationsQuery,
  ListMessagesQuery,
  ConversationIdParam,
} from '../../../src/modules/memory/schema';

describe('CreateConversationInput', () => {
  it('accepts empty body', () => {
    const r = CreateConversationInput.parse({});
    expect(r).toEqual({});
  });

  it('accepts title with 1-200 chars', () => {
    const r = CreateConversationInput.parse({ title: 'hello' });
    expect(r.title).toBe('hello');
  });

  it('rejects title longer than 200', () => {
    expect(() => CreateConversationInput.parse({ title: 'a'.repeat(201) })).toThrow();
  });

  it('coerces empty-string title to null', () => {
    const r = CreateConversationInput.parse({ title: '' });
    expect(r.title).toBeNull();
  });
});

describe('AddMessageInput', () => {
  it('accepts valid role + content', () => {
    expect(AddMessageInput.parse({ role: 'user', content: 'hi' })).toEqual({ role: 'user', content: 'hi' });
    expect(AddMessageInput.parse({ role: 'ai', content: 'hi' }).role).toBe('ai');
    expect(AddMessageInput.parse({ role: 'system', content: 'hi' }).role).toBe('system');
  });

  it('rejects invalid role', () => {
    expect(() => AddMessageInput.parse({ role: 'bot', content: 'x' })).toThrow();
  });

  it('rejects empty content', () => {
    expect(() => AddMessageInput.parse({ role: 'user', content: '' })).toThrow();
  });

  it('rejects content longer than 65535', () => {
    expect(() => AddMessageInput.parse({ role: 'user', content: 'a'.repeat(65536) })).toThrow();
  });
});

describe('ListConversationsQuery', () => {
  it('applies defaults when empty', () => {
    const r = ListConversationsQuery.parse({});
    expect(r.limit).toBe(20);
    expect(r.cursor).toBeUndefined();
  });

  it('coerces limit from string (query param)', () => {
    const r = ListConversationsQuery.parse({ limit: '50' });
    expect(r.limit).toBe(50);
  });

  it('clamps limit to max 100', () => {
    expect(() => ListConversationsQuery.parse({ limit: '101' })).toThrow();
  });
});

describe('ListMessagesQuery', () => {
  it('default limit is 50', () => {
    expect(ListMessagesQuery.parse({}).limit).toBe(50);
  });

  it('clamps limit to max 200', () => {
    expect(() => ListMessagesQuery.parse({ limit: '201' })).toThrow();
  });
});

describe('ConversationIdParam', () => {
  it('accepts 26-char ULID-ish string', () => {
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
pnpm test:unit test/unit/memory/schema.test.ts
```

Expected:FAIL(文件尚未创建,import error)。

- [ ] **Step 3: 创建 `src/modules/memory/schema.ts`**

```typescript
import { z } from 'zod';
import { MESSAGE_ROLES } from './domain/message';

export const CreateConversationInput = z.object({
  title: z.string()
    .max(200)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInput>;

export const AddMessageInput = z.object({
  role: z.enum(MESSAGE_ROLES as unknown as [string, ...string[]]),
  content: z.string().min(1).max(65535),
});
export type AddMessageInput = z.infer<typeof AddMessageInput>;

export const ListConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuery>;

export const ListMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const ConversationIdParam = z.object({
  id: z.string().length(26),
});
export type ConversationIdParam = z.infer<typeof ConversationIdParam>;
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/memory/schema.test.ts
```

Expected:PASS(所有测试)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/schema.ts test/unit/memory/schema.test.ts
git commit -m "feat(s2): add memory zod schemas"
```

---

## Task 6 · Cursor 编码工具

**Files:**
- Create: `src/modules/memory/repositories/cursor.ts`
- Test: `test/unit/memory/cursor.test.ts`

Cursor-based pagination 需要把 `(updated_at|created_at, id)` 的二元组序列化成 opaque 字符串。单独抽一个小工具方便 repository 复用。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../src/modules/memory/repositories/cursor';

describe('cursor', () => {
  it('round-trips an ISO date + id', () => {
    const t = new Date('2026-04-23T10:15:30.123Z');
    const id = '01K40A8Y3V9E2XBSG5HMTVKQ11';
    const c = encodeCursor({ t, id });
    expect(c).toMatch(/^[A-Za-z0-9+/=_-]+$/);  // base64url-ish
    const back = decodeCursor(c);
    expect(back.id).toBe(id);
    expect(back.t.toISOString()).toBe(t.toISOString());
  });

  it('rejects malformed cursor', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
    expect(() => decodeCursor('eyJicm9rZW4iOnRydWV9')).toThrow();  // valid base64 but wrong shape
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/memory/cursor.test.ts
```

Expected:FAIL(文件缺失)。

- [ ] **Step 3: 实现**

```typescript
export type CursorPayload = { t: Date; id: string };

export function encodeCursor(p: CursorPayload): string {
  const obj = { t: p.t.toISOString(), id: p.id };
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): CursorPayload {
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
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/memory/cursor.test.ts
```

Expected:PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/repositories/cursor.ts test/unit/memory/cursor.test.ts
git commit -m "feat(s2): add cursor codec for pagination"
```

---

## Task 7 · ConversationRepository

**Files:**
- Create: `src/modules/memory/repositories/conversation.repository.ts`

> 本 Task 不写单测,放到 Task 11 的 integration 测试一次性覆盖 CRUD 和分页(需要真 MySQL 保证 FK 语义)。

- [ ] **Step 1: 创建文件**

```typescript
import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { Conversation } from '../domain/conversation';
import { encodeCursor, decodeCursor, type CursorPayload } from './cursor';

function rowToConversation(row: {
  id: string; user_id: string; title: string | null;
  created_at: Date; updated_at: Date;
}): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(c: {
    id: string; userId: string; title: string | null; now: Date;
  }): Promise<void> {
    await this.db.insertInto('conversations').values({
      id: c.id,
      user_id: c.userId,
      title: c.title,
      created_at: c.now,
      updated_at: c.now,
    }).execute();
  }

  async findById(id: string): Promise<Conversation | null> {
    const row = await this.db.selectFrom('conversations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? rowToConversation(row) : null;
  }

  async listByUser(userId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Conversation[]; nextCursor: string | null }> {

    let query = this.db.selectFrom('conversations')
      .selectAll()
      .where('user_id', '=', userId);

    if (opts.cursor) {
      const { t, id } = decodeCursor(opts.cursor);
      // (updated_at, id) < (cursor.t, cursor.id), DESC pagination
      query = query.where((eb) => eb.or([
        eb('updated_at', '<', t),
        eb.and([eb('updated_at', '=', t), eb('id', '<', id)]),
      ]));
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit + 1)
      .execute();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(rowToConversation);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.updatedAt, id: last.id } satisfies CursorPayload)
      : null;

    return { items, nextCursor };
  }

  async touchUpdatedAt(id: string, now: Date): Promise<void> {
    await this.db.updateTable('conversations')
      .set({ updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async deleteById(id: string): Promise<void> {
    await this.db.deleteFrom('conversations')
      .where('id', '=', id)
      .execute();
  }
}
```

**关键点**:
- 分页拿 `limit + 1` 条判断 `hasMore`,避免多一次 count 查询
- cursor 语义是"已经看到的最后一条",所以新的一页从 `(t, id)` **小于** cursor 开始(DESC)
- `touchUpdatedAt` 多一个 `now` 参数 —— 保证和 S1.1 一致,时间由 service 层统一传入,便于测试注入

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/memory/repositories/conversation.repository.ts
git commit -m "feat(s2): add ConversationRepository (CRUD + cursor pagination)"
```

---

## Task 8 · MessageRepository

**Files:**
- Create: `src/modules/memory/repositories/message.repository.ts`

- [ ] **Step 1: 创建文件**

```typescript
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../core/db';
import type { Message, MessageRole } from '../domain/message';
import { encodeCursor, decodeCursor, type CursorPayload } from './cursor';

function rowToMessage(row: {
  id: string; conversation_id: string; role: 'user' | 'ai' | 'system';
  content: string; created_at: Date;
}): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

type Executor = Kysely<Database> | Transaction<Database>;

export class MessageRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(
    m: { id: string; conversationId: string; role: MessageRole; content: string; now: Date },
    executor?: Executor,
  ): Promise<void> {
    const exec = executor ?? this.db;
    await exec.insertInto('messages').values({
      id: m.id,
      conversation_id: m.conversationId,
      role: m.role,
      content: m.content,
      created_at: m.now,
    }).execute();
  }

  async listByConversation(conversationId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Message[]; nextCursor: string | null }> {

    let query = this.db.selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', conversationId);

    if (opts.cursor) {
      const { t, id } = decodeCursor(opts.cursor);
      // (created_at, id) > (cursor.t, cursor.id), ASC pagination
      query = query.where((eb) => eb.or([
        eb('created_at', '>', t),
        eb.and([eb('created_at', '=', t), eb('id', '>', id)]),
      ]));
    }

    const rows = await query
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(opts.limit + 1)
      .execute();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(rowToMessage);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.createdAt, id: last.id } satisfies CursorPayload)
      : null;

    return { items, nextCursor };
  }
}
```

**关键点**:
- `insert` 接受可选 `executor`,允许 service 层传入事务句柄。这样 `addMessage` 的 insert + touch 能在同一事务里跑
- 分页方向和 conversation 相反:messages 要**按时间正序回放**,所以 cursor 取 `>`,`orderBy` 是 `asc`

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/memory/repositories/message.repository.ts
git commit -m "feat(s2): add MessageRepository (insert with tx + cursor list)"
```

---

## Task 9 · ConversationRepository 类似地支持事务

**Files:**
- Modify: `src/modules/memory/repositories/conversation.repository.ts`

`touchUpdatedAt` 和 `insert` 需要能被 transaction 复用,模式和 Task 8 的 MessageRepository 对齐。

- [ ] **Step 1: 改 ConversationRepository,加事务支持**

把 `touchUpdatedAt` 和 `insert` 改成接受可选 executor:

```typescript
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../core/db';
// ... 其余 import 保持

type Executor = Kysely<Database> | Transaction<Database>;

export class ConversationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(
    c: { id: string; userId: string; title: string | null; now: Date },
    executor?: Executor,
  ): Promise<void> {
    const exec = executor ?? this.db;
    await exec.insertInto('conversations').values({
      id: c.id,
      user_id: c.userId,
      title: c.title,
      created_at: c.now,
      updated_at: c.now,
    }).execute();
  }

  // findById / listByUser 无需事务,保持原样

  async touchUpdatedAt(
    id: string,
    now: Date,
    executor?: Executor,
  ): Promise<void> {
    const exec = executor ?? this.db;
    await exec.updateTable('conversations')
      .set({ updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async deleteById(id: string): Promise<void> {
    await this.db.deleteFrom('conversations')
      .where('id', '=', id)
      .execute();
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
git add src/modules/memory/repositories/conversation.repository.ts
git commit -m "refactor(s2): conversation repo methods accept optional tx executor"
```

---

## Task 10 · MemoryService(骨架 + createConversation + 归属校验帮助方法)

**Files:**
- Create: `src/modules/memory/services/memory.service.ts`
- Test: `test/unit/memory/memory.service.test.ts`

- [ ] **Step 1: 写失败测试 `test/unit/memory/memory.service.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MemoryService } from '../../../src/modules/memory/services/memory.service';
import { ConversationNotFoundError, ConversationForbiddenError } from '../../../src/modules/memory/domain/errors';
import type { Conversation } from '../../../src/modules/memory/domain/conversation';
import type { Message } from '../../../src/modules/memory/domain/message';

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '01K40A8Y3V9E2XBSG5HMTVKQ11',
    userId: '01K40A8Y3V9E2XBSG5HMTVKQ22',
    title: null,
    createdAt: new Date('2026-04-23T10:00:00.000Z'),
    updatedAt: new Date('2026-04-23T10:00:00.000Z'),
    ...overrides,
  };
}

describe('MemoryService.createConversation', () => {
  it('inserts with ULID id and given userId', async () => {
    const convRepo = {
      insert: vi.fn(async () => {}),
      findById: vi.fn(),
      listByUser: vi.fn(),
      touchUpdatedAt: vi.fn(),
      deleteById: vi.fn(),
    };
    const msgRepo = { insert: vi.fn(), listByConversation: vi.fn() };
    const db = { transaction: vi.fn() };
    const service = new MemoryService(convRepo as any, msgRepo as any, db as any);

    const result = await service.createConversation('user1', { title: 'hello' });

    expect(convRepo.insert).toHaveBeenCalledOnce();
    const arg = convRepo.insert.mock.calls[0][0];
    expect(arg.userId).toBe('user1');
    expect(arg.title).toBe('hello');
    expect(arg.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(result.userId).toBe('user1');
    expect(result.title).toBe('hello');
  });

  it('accepts null title', async () => {
    const convRepo = {
      insert: vi.fn(async () => {}),
      findById: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    const result = await service.createConversation('user1', { title: null });
    expect(result.title).toBeNull();
  });
});

describe('MemoryService.getConversation', () => {
  it('returns the conversation when owned by user', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    const r = await service.getConversation('user1', conv.id);
    expect(r.id).toBe(conv.id);
  });

  it('throws ConversationNotFoundError when id unknown', async () => {
    const convRepo = {
      findById: vi.fn(async () => null),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.getConversation('user1', 'missing')).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it('throws ConversationForbiddenError when owned by another user', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.getConversation('user1', conv.id)).rejects.toBeInstanceOf(ConversationForbiddenError);
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/memory/memory.service.test.ts
```

Expected:FAIL(service 文件不存在)。

- [ ] **Step 3: 创建 service 骨架 `src/modules/memory/services/memory.service.ts`**

```typescript
import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../core/db';
import type { Conversation } from '../domain/conversation';
import type { Message, MessageRole } from '../domain/message';
import { ConversationNotFoundError, ConversationForbiddenError } from '../domain/errors';
import type { ConversationRepository } from '../repositories/conversation.repository';
import type { MessageRepository } from '../repositories/message.repository';

export class MemoryService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly db: Kysely<Database>,
  ) {}

  async createConversation(userId: string, input: { title?: string | null }): Promise<Conversation> {
    const id = ulid();
    const now = new Date();
    const title = input.title ?? null;
    await this.conversations.insert({ id, userId, title, now });
    return { id, userId, title, createdAt: now, updatedAt: now };
  }

  async getConversation(userId: string, id: string): Promise<Conversation> {
    const conv = await this.conversations.findById(id);
    if (!conv) throw new ConversationNotFoundError();
    if (conv.userId !== userId) throw new ConversationForbiddenError();
    return conv;
  }

  // listConversations / deleteConversation / addMessage / listMessages 下一 Task 加
}
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/memory/memory.service.test.ts
```

Expected:PASS(上面三组 describe)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/services/memory.service.ts test/unit/memory/memory.service.test.ts
git commit -m "feat(s2): MemoryService create + get (with ownership check)"
```

---

## Task 11 · MemoryService · listConversations + deleteConversation

**Files:**
- Modify: `src/modules/memory/services/memory.service.ts`
- Modify: `test/unit/memory/memory.service.test.ts`

- [ ] **Step 1: 在测试文件追加 describe 块**

在 `test/unit/memory/memory.service.test.ts` 末尾追加:

```typescript
describe('MemoryService.listConversations', () => {
  it('passes userId + opts through to repository', async () => {
    const convRepo = {
      listByUser: vi.fn(async () => ({ items: [], nextCursor: null })),
      findById: vi.fn(), insert: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    const r = await service.listConversations('user1', { limit: 20, cursor: 'abc' });
    expect(convRepo.listByUser).toHaveBeenCalledWith('user1', { limit: 20, cursor: 'abc' });
    expect(r.items).toEqual([]);
  });
});

describe('MemoryService.deleteConversation', () => {
  it('deletes when owned by user', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      deleteById: vi.fn(async () => {}),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await service.deleteConversation('user1', conv.id);
    expect(convRepo.deleteById).toHaveBeenCalledWith(conv.id);
  });

  it('throws ConversationForbiddenError when owned by another user', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      deleteById: vi.fn(),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.deleteConversation('user1', conv.id)).rejects.toBeInstanceOf(ConversationForbiddenError);
    expect(convRepo.deleteById).not.toHaveBeenCalled();
  });

  it('throws ConversationNotFoundError when id unknown', async () => {
    const convRepo = {
      findById: vi.fn(async () => null),
      deleteById: vi.fn(),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, {} as any, {} as any);
    await expect(service.deleteConversation('user1', 'missing')).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
```

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/memory/memory.service.test.ts
```

Expected:FAIL(新的 describe 里 method 不存在)。

- [ ] **Step 3: 在 MemoryService 里补方法**

在 `getConversation` 方法之后加:

```typescript
  async listConversations(userId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Conversation[]; nextCursor: string | null }> {
    return this.conversations.listByUser(userId, opts);
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    // 先校验归属,再删(复用 getConversation 的错误语义)
    await this.getConversation(userId, id);
    await this.conversations.deleteById(id);
  }
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit test/unit/memory/memory.service.test.ts
```

Expected:PASS(全部)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/services/memory.service.ts test/unit/memory/memory.service.test.ts
git commit -m "feat(s2): MemoryService listConversations + deleteConversation"
```

---

## Task 12 · MemoryService · addMessage(事务)+ listMessages

**Files:**
- Modify: `src/modules/memory/services/memory.service.ts`
- Modify: `test/unit/memory/memory.service.test.ts`

- [ ] **Step 1: 追加测试**

```typescript
describe('MemoryService.addMessage', () => {
  it('inserts message + touches conversation inside a transaction', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      touchUpdatedAt: vi.fn(async () => {}),
      insert: vi.fn(), listByUser: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = {
      insert: vi.fn(async () => {}),
      listByConversation: vi.fn(),
    };
    // Fake a Kysely-like db with a transaction() helper
    const executor = { __tx: true };
    const db = {
      transaction: () => ({ execute: async (fn: (tx: any) => any) => fn(executor) }),
    };
    const service = new MemoryService(convRepo as any, msgRepo as any, db as any);

    const msg = await service.addMessage('user1', conv.id, { role: 'user', content: 'hi' });

    expect(msgRepo.insert).toHaveBeenCalledOnce();
    expect(convRepo.touchUpdatedAt).toHaveBeenCalledOnce();
    // Both calls received the tx executor
    expect(msgRepo.insert.mock.calls[0][1]).toBe(executor);
    expect(convRepo.touchUpdatedAt.mock.calls[0][2]).toBe(executor);
    expect(msg.conversationId).toBe(conv.id);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hi');
    expect(msg.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('throws ConversationForbiddenError before touching db when not owner', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      touchUpdatedAt: vi.fn(),
      insert: vi.fn(), listByUser: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = { insert: vi.fn(), listByConversation: vi.fn() };
    const db = { transaction: vi.fn() };
    const service = new MemoryService(convRepo as any, msgRepo as any, db as any);

    await expect(
      service.addMessage('user1', conv.id, { role: 'user', content: 'x' }),
    ).rejects.toBeInstanceOf(ConversationForbiddenError);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(msgRepo.insert).not.toHaveBeenCalled();
  });
});

describe('MemoryService.listMessages', () => {
  it('enforces ownership then delegates to repo', async () => {
    const conv = makeConv({ userId: 'user1' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = {
      listByConversation: vi.fn(async () => ({ items: [], nextCursor: null })),
      insert: vi.fn(),
    };
    const service = new MemoryService(convRepo as any, msgRepo as any, {} as any);

    const r = await service.listMessages('user1', conv.id, { limit: 50 });
    expect(msgRepo.listByConversation).toHaveBeenCalledWith(conv.id, { limit: 50 });
    expect(r.items).toEqual([]);
  });

  it('refuses when caller is not owner', async () => {
    const conv = makeConv({ userId: 'other' });
    const convRepo = {
      findById: vi.fn(async () => conv),
      insert: vi.fn(), listByUser: vi.fn(), touchUpdatedAt: vi.fn(), deleteById: vi.fn(),
    };
    const msgRepo = { listByConversation: vi.fn(), insert: vi.fn() };
    const service = new MemoryService(convRepo as any, msgRepo as any, {} as any);

    await expect(
      service.listMessages('user1', conv.id, { limit: 50 }),
    ).rejects.toBeInstanceOf(ConversationForbiddenError);
    expect(msgRepo.listByConversation).not.toHaveBeenCalled();
  });
});
```

别忘了在测试文件顶部的 import 里确保 `ConversationForbiddenError` 已引入。

- [ ] **Step 2: 跑测试,验证失败**

```bash
pnpm test:unit test/unit/memory/memory.service.test.ts
```

Expected:FAIL(method 未实现)。

- [ ] **Step 3: 在 MemoryService 补方法**

```typescript
  async addMessage(
    userId: string,
    conversationId: string,
    input: { role: MessageRole; content: string },
  ): Promise<Message> {
    // 归属校验先行,避免开事务后才 rollback
    await this.getConversation(userId, conversationId);

    const id = ulid();
    const now = new Date();

    await this.db.transaction().execute(async (tx) => {
      await this.messages.insert(
        { id, conversationId, role: input.role, content: input.content, now },
        tx,
      );
      await this.conversations.touchUpdatedAt(conversationId, now, tx);
    });

    return { id, conversationId, role: input.role, content: input.content, createdAt: now };
  }

  async listMessages(
    userId: string,
    conversationId: string,
    opts: { limit: number; cursor?: string | null },
  ): Promise<{ items: Message[]; nextCursor: string | null }> {
    await this.getConversation(userId, conversationId);
    return this.messages.listByConversation(conversationId, opts);
  }
```

- [ ] **Step 4: 跑测试,验证通过**

```bash
pnpm test:unit
```

Expected:PASS(含 S1.1 既有 + memory 所有 service 测试)。

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/services/memory.service.ts test/unit/memory/memory.service.test.ts
git commit -m "feat(s2): MemoryService addMessage (tx) + listMessages"
```

---

## Task 13 · MemoryController

**Files:**
- Create: `src/modules/memory/controllers/memory.controller.ts`

> Controller 是薄 glue 层,不写单测;e2e 测试(Task 18)覆盖完整链路。

- [ ] **Step 1: 创建文件**

```typescript
import type { Request, Response, NextFunction } from 'express';
import type { AuthCtx } from '../../../middleware/require-session';
import type { MemoryService } from '../services/memory.service';
import {
  CreateConversationInput,
  AddMessageInput,
  ListConversationsQuery,
  ListMessagesQuery,
  ConversationIdParam,
} from '../schema';

export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  createConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const input = CreateConversationInput.parse(req.body ?? {});
      const c = await this.memory.createConversation(auth.userId, { title: input.title ?? null });
      res.status(201).json(c);
    } catch (e) { next(e); }
  };

  listConversations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const q = ListConversationsQuery.parse(req.query);
      const r = await this.memory.listConversations(auth.userId, { limit: q.limit, cursor: q.cursor });
      res.status(200).json(r);
    } catch (e) { next(e); }
  };

  getConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const c = await this.memory.getConversation(auth.userId, id);
      res.status(200).json(c);
    } catch (e) { next(e); }
  };

  deleteConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      await this.memory.deleteConversation(auth.userId, id);
      res.status(204).send();
    } catch (e) { next(e); }
  };

  addMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const input = AddMessageInput.parse(req.body);
      const m = await this.memory.addMessage(auth.userId, id, { role: input.role as any, content: input.content });
      res.status(201).json(m);
    } catch (e) { next(e); }
  };

  listMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const q = ListMessagesQuery.parse(req.query);
      const r = await this.memory.listMessages(auth.userId, id, { limit: q.limit, cursor: q.cursor });
      res.status(200).json(r);
    } catch (e) { next(e); }
  };
}
```

`input.role as any`:zod 的 `z.enum(MESSAGE_ROLES as [...])` 类型推断出 `string`,运行时已经校验合法,类型上断言回 `MessageRole` 由 service 层继续推。

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/memory/controllers/memory.controller.ts
git commit -m "feat(s2): add MemoryController"
```

---

## Task 14 · Routes

**Files:**
- Create: `src/modules/memory/routes.ts`

- [ ] **Step 1: 创建文件**

```typescript
import { Router, type RequestHandler } from 'express';
import type { MemoryController } from './controllers/memory.controller';

export function buildMemoryRoutes(opts: {
  memoryCtrl: MemoryController;
  requireSession: RequestHandler;
}): Router {
  const r = Router();
  const { memoryCtrl, requireSession } = opts;

  r.post('/conversations', requireSession, memoryCtrl.createConversation);
  r.get('/conversations', requireSession, memoryCtrl.listConversations);
  r.get('/conversations/:id', requireSession, memoryCtrl.getConversation);
  r.delete('/conversations/:id', requireSession, memoryCtrl.deleteConversation);
  r.post('/conversations/:id/messages', requireSession, memoryCtrl.addMessage);
  r.get('/conversations/:id/messages', requireSession, memoryCtrl.listMessages);

  return r;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected:无报错。

- [ ] **Step 3: Commit**

```bash
git add src/modules/memory/routes.ts
git commit -m "feat(s2): add memory routes"
```

---

## Task 15 · 装配进 main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 追加 import(文件顶部,identity import 之后)**

在 `import { authEvents } from './modules/identity/events';` 之后追加:

```typescript
import { ConversationRepository } from './modules/memory/repositories/conversation.repository';
import { MessageRepository } from './modules/memory/repositories/message.repository';
import { MemoryService } from './modules/memory/services/memory.service';
import { MemoryController } from './modules/memory/controllers/memory.controller';
import { buildMemoryRoutes } from './modules/memory/routes';
```

- [ ] **Step 2: 在 `buildApp()` 里装配 memory 模块**

找到现有的 `const auth = new AuthService(...)` 那一段,之后插入:

```typescript
  // S2 memory module
  const conversationRepo = new ConversationRepository(db);
  const messageRepo = new MessageRepository(db);
  const memoryService = new MemoryService(conversationRepo, messageRepo, db);
  const memoryCtrl = new MemoryController(memoryService);
```

- [ ] **Step 3: 挂路由**

找到 `app.use('/api', buildIdentityRoutes(...))` 之后,追加:

```typescript
  app.use('/api/memory', buildMemoryRoutes({
    memoryCtrl,
    requireSession: requireSession(sessions, cfg.session.cookieName),
  }));
```

**注意**:identity 路由走 `/api`,memory 路由走 `/api/memory`(在 Router 内部再拼 `/conversations/...`)。最终完整 path 是 `/api/memory/conversations/...`。

- [ ] **Step 4: Typecheck + 起服务冒烟**

```bash
pnpm typecheck
```

Expected:无报错。

```bash
pnpm dev
```

手工访问 `http://localhost:<PORT>/api/memory/conversations`,预期 `401 UNAUTHENTICATED`(未登录挡下,说明路由挂上了、requireSession 生效)。按 Ctrl-C 停止。

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(s2): wire memory module into main.ts"
```

---

## Task 16 · Integration 测试:migration

**Files:**
- Create: `test/integration/memory/migration.int.test.ts`

> 现有 `test/integration/setup.ts` 已有 testcontainers MySQL helper。复用它,不重建基础设施。

- [ ] **Step 1: 先看一眼 setup.ts 怎么用的**

```bash
cat test/integration/setup.ts
```

记下导出的 helper(比如 `startMysql()` / `applyMigrations()` / 类似名字)和它们的签名。下面的代码用**假设名**,执行时按实际 setup.ts 的 API 调整。

- [ ] **Step 2: 创建测试文件**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../../src/core/db';
// 以下 import 根据实际 setup.ts 导出的 helper 调整
import { startTestDb, stopTestDb } from '../setup';

let db: Kysely<Database>;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  cleanup = ctx.stop ?? stopTestDb;
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('memory migration', () => {
  it('creates conversations table with expected columns', async () => {
    const rows = await sql<{ COLUMN_NAME: string }>`
      SELECT COLUMN_NAME FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'conversations'
    `.execute(db);
    const names = rows.rows.map((r) => r.COLUMN_NAME);
    expect(names).toEqual(expect.arrayContaining(['id', 'user_id', 'title', 'created_at', 'updated_at']));
  });

  it('creates messages table with CHECK on role', async () => {
    const rows = await sql<{ CONSTRAINT_NAME: string }>`
      SELECT CONSTRAINT_NAME FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'chk_messages_role'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('rejects message with invalid role via CHECK', async () => {
    // 插一条 user 以便挂 conversation(如果 setup 没种用户,跳过该断言)
    await expect(sql`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES ('01K00000000000000000000000', '01K00000000000000000000001', 'bot', 'x', NOW(3))
    `.execute(db)).rejects.toThrow();
  });
});
```

**实际 setup.ts API 可能不同**:执行时先读 `test/integration/setup.ts`,按实际导出调整 `beforeAll` 里的初始化调用。关键是**测试运行前 migration 已经跑完**。

- [ ] **Step 3: 跑测试**

```bash
pnpm test:integration test/integration/memory/migration.int.test.ts
```

Expected:PASS 三条。若 setup API 不对,先修 Step 2 代码再跑。

- [ ] **Step 4: Commit**

```bash
git add test/integration/memory/migration.int.test.ts
git commit -m "test(s2): migration integration test"
```

---

## Task 17 · Integration 测试:ConversationRepository

**Files:**
- Create: `test/integration/memory/conversation.repository.int.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let repo: ConversationRepository;
let userId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  repo = new ConversationRepository(db);

  // Insert a user as FK target
  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `mem-test-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Mem Tester',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await (ctx as any).stop?.();  // if setup returns a stop fn
});

beforeEach(async () => {
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
});

describe('ConversationRepository', () => {
  it('inserts and findById round-trips', async () => {
    const id = ulid();
    const now = new Date('2026-04-23T10:00:00.000Z');
    await repo.insert({ id, userId, title: 'hello', now });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('hello');
    expect(found!.userId).toBe(userId);
  });

  it('listByUser orders by updated_at DESC with stable id tiebreaker', async () => {
    const t1 = new Date('2026-04-23T10:00:00.000Z');
    const t2 = new Date('2026-04-23T11:00:00.000Z');
    const idA = ulid(), idB = ulid(), idC = ulid();
    await repo.insert({ id: idA, userId, title: 'A', now: t1 });
    await repo.insert({ id: idB, userId, title: 'B', now: t2 });
    await repo.insert({ id: idC, userId, title: 'C', now: t2 });

    const r = await repo.listByUser(userId, { limit: 10 });
    expect(r.items.map((c) => c.title)).toEqual([idC > idB ? 'C' : 'B', idC > idB ? 'B' : 'C', 'A']);
    expect(r.nextCursor).toBeNull();
  });

  it('listByUser paginates with cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.insert({ id: ulid(), userId, title: `c${i}`, now: new Date(Date.now() + i * 1000) });
    }
    const p1 = await repo.listByUser(userId, { limit: 2 });
    expect(p1.items.length).toBe(2);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await repo.listByUser(userId, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.length).toBe(2);
    // First page items should not overlap with second
    const ids1 = new Set(p1.items.map((c) => c.id));
    for (const c of p2.items) expect(ids1.has(c.id)).toBe(false);

    const p3 = await repo.listByUser(userId, { limit: 2, cursor: p2.nextCursor });
    expect(p3.items.length).toBe(1);
    expect(p3.nextCursor).toBeNull();
  });

  it('touchUpdatedAt actually updates the timestamp', async () => {
    const id = ulid();
    const t0 = new Date('2026-04-23T10:00:00.000Z');
    await repo.insert({ id, userId, title: null, now: t0 });
    const t1 = new Date('2026-04-23T12:00:00.000Z');
    await repo.touchUpdatedAt(id, t1);
    const back = await repo.findById(id);
    expect(back!.updatedAt.toISOString()).toBe(t1.toISOString());
    expect(back!.createdAt.toISOString()).toBe(t0.toISOString());
  });

  it('deleteById removes the row', async () => {
    const id = ulid();
    await repo.insert({ id, userId, title: null, now: new Date() });
    await repo.deleteById(id);
    expect(await repo.findById(id)).toBeNull();
  });
});
```

**注意**:`ctx` 的清理 API 以实际 setup.ts 为准;上面代码里的 `(ctx as any).stop?.()` 是占位写法,执行时替换。

- [ ] **Step 2: 跑测试**

```bash
pnpm test:integration test/integration/memory/conversation.repository.int.test.ts
```

Expected:PASS 5 条。

- [ ] **Step 3: Commit**

```bash
git add test/integration/memory/conversation.repository.int.test.ts
git commit -m "test(s2): conversation.repository integration suite"
```

---

## Task 18 · Integration 测试:MessageRepository + FK CASCADE

**Files:**
- Create: `test/integration/memory/message.repository.int.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../src/core/db';
import { ConversationRepository } from '../../../src/modules/memory/repositories/conversation.repository';
import { MessageRepository } from '../../../src/modules/memory/repositories/message.repository';
import { startTestDb } from '../setup';

let db: Kysely<Database>;
let convRepo: ConversationRepository;
let msgRepo: MessageRepository;
let userId: string;
let conversationId: string;

beforeAll(async () => {
  const ctx = await startTestDb();
  db = ctx.db;
  convRepo = new ConversationRepository(db);
  msgRepo = new MessageRepository(db);

  userId = ulid();
  await db.insertInto('users').values({
    id: userId,
    email: `msg-test-${userId}@example.com`,
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Msg Tester',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}, 120_000);

afterAll(async () => {
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

beforeEach(async () => {
  // Fresh conversation per test
  await db.deleteFrom('conversations').where('user_id', '=', userId).execute();
  conversationId = ulid();
  await convRepo.insert({ id: conversationId, userId, title: null, now: new Date() });
});

describe('MessageRepository', () => {
  it('insert + listByConversation returns messages in ASC time order', async () => {
    const t1 = new Date('2026-04-23T10:00:00.000Z');
    const t2 = new Date('2026-04-23T10:01:00.000Z');
    const t3 = new Date('2026-04-23T10:02:00.000Z');
    await msgRepo.insert({ id: ulid(), conversationId, role: 'user', content: 'hi', now: t1 });
    await msgRepo.insert({ id: ulid(), conversationId, role: 'ai', content: 'hello', now: t2 });
    await msgRepo.insert({ id: ulid(), conversationId, role: 'user', content: 'bye', now: t3 });

    const r = await msgRepo.listByConversation(conversationId, { limit: 10 });
    expect(r.items.map((m) => m.content)).toEqual(['hi', 'hello', 'bye']);
    expect(r.nextCursor).toBeNull();
  });

  it('cursor pagination: second page continues from where first ended', async () => {
    for (let i = 0; i < 5; i++) {
      await msgRepo.insert({
        id: ulid(), conversationId, role: 'user', content: `m${i}`,
        now: new Date(Date.now() + i * 1000),
      });
    }
    const p1 = await msgRepo.listByConversation(conversationId, { limit: 2 });
    expect(p1.items.length).toBe(2);
    const p2 = await msgRepo.listByConversation(conversationId, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.length).toBe(2);
    const p1Ids = new Set(p1.items.map((m) => m.id));
    for (const m of p2.items) expect(p1Ids.has(m.id)).toBe(false);
  });

  it('FK CASCADE: deleting conversation removes its messages', async () => {
    await msgRepo.insert({ id: ulid(), conversationId, role: 'user', content: 'x', now: new Date() });
    await msgRepo.insert({ id: ulid(), conversationId, role: 'ai', content: 'y', now: new Date() });

    await convRepo.deleteById(conversationId);

    const count = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ${conversationId}
    `.execute(db);
    expect(Number(count.rows[0].n)).toBe(0);
  });

  it('insert uses optional tx executor when given', async () => {
    const id1 = ulid(), id2 = ulid();
    await db.transaction().execute(async (tx) => {
      await msgRepo.insert({ id: id1, conversationId, role: 'user', content: 'a', now: new Date() }, tx);
      await msgRepo.insert({ id: id2, conversationId, role: 'ai', content: 'b', now: new Date() }, tx);
    });
    const r = await msgRepo.listByConversation(conversationId, { limit: 10 });
    expect(r.items.length).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
pnpm test:integration test/integration/memory/message.repository.int.test.ts
```

Expected:PASS 4 条。

- [ ] **Step 3: Commit**

```bash
git add test/integration/memory/message.repository.int.test.ts
git commit -m "test(s2): message.repository integration suite (incl. FK cascade)"
```

---

## Task 19 · E2E 测试

**Files:**
- Create: `test/e2e/memory.e2e.test.ts`

> 参考 S1.1 既有 `test/e2e/auth.e2e.test.ts` 的 supertest + 启动真实 app 的结构。如果那边有已有的 `buildTestApp` helper,复用即可。

- [ ] **Step 1: 先读一下 S1.1 e2e 测试结构**

```bash
cat test/e2e/auth.e2e.test.ts | head -60
```

记下:它怎么启动 app、怎么跑 migration、怎么创建用户、怎么完成 login 拿 cookie。下面的代码用**假设的 helper 名**(`buildTestApp`, `registerTestUser`),按实际调整。

- [ ] **Step 2: 创建 e2e 测试文件**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
// 下列 import 按实际 setup 调整
import { buildTestApp, type TestAppCtx } from './setup';  // 或者就直接用 S1.1 里的 helper

let ctx: TestAppCtx;
let app: Express;

// 两个独立用户 + 他们的登录 cookie
let userA: { email: string; password: string; cookie: string };
let userB: { email: string; password: string; cookie: string };

beforeAll(async () => {
  ctx = await buildTestApp();    // 按 S1.1 e2e 的 helper 改
  app = ctx.app;

  // 准备用户 A、B。具体 API 参考 S1.1 e2e 里怎么做的;
  // 下面是一个常见写法:直接访问 auth.service 创建
  const mkUser = async (email: string) => {
    const password = 'CorrectHorseBatteryStaple9!';
    await ctx.services.auth.createUser({
      email, password, displayName: email.split('@')[0],
    });
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const rawCookie = login.headers['set-cookie'][0];
    return { email, password, cookie: rawCookie };
  };
  userA = await mkUser('a@mem.test');
  userB = await mkUser('b@mem.test');
}, 180_000);

afterAll(async () => {
  await ctx.shutdown();
});

describe('Memory API · authentication', () => {
  it('returns 401 UNAUTHENTICATED when no cookie is supplied', async () => {
    const r = await request(app).get('/api/memory/conversations');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('Memory API · conversation CRUD golden path', () => {
  it('creates, lists, reads, and deletes a conversation', async () => {
    const create = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie)
      .send({ title: 'first' });
    expect(create.status).toBe(201);
    expect(create.body.title).toBe('first');
    const id = create.body.id;

    const get = await request(app).get(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(get.status).toBe(200);
    expect(get.body.id).toBe(id);

    const list = await request(app).get('/api/memory/conversations')
      .set('Cookie', userA.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);

    const del = await request(app).delete(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });
});

describe('Memory API · messages + updated_at', () => {
  it('appending a message updates conversation.updated_at', async () => {
    const created = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({ title: 't' });
    const id = created.body.id;
    const baseUpdated = created.body.updatedAt;

    // small delay to guarantee tick
    await new Promise((r) => setTimeout(r, 10));

    const add = await request(app).post(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie)
      .send({ role: 'user', content: 'hello' });
    expect(add.status).toBe(201);
    expect(add.body.role).toBe('user');
    expect(add.body.content).toBe('hello');

    const reread = await request(app).get(`/api/memory/conversations/${id}`)
      .set('Cookie', userA.cookie);
    expect(new Date(reread.body.updatedAt).getTime())
      .toBeGreaterThan(new Date(baseUpdated).getTime());
  });

  it('lists messages in ASC order', async () => {
    const created = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({});
    const id = created.body.id;
    for (const c of ['one', 'two', 'three']) {
      await request(app).post(`/api/memory/conversations/${id}/messages`)
        .set('Cookie', userA.cookie)
        .send({ role: 'user', content: c });
    }
    const list = await request(app).get(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: any) => m.content)).toEqual(['one', 'two', 'three']);
  });
});

describe('Memory API · cross-user isolation', () => {
  let aConvId: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie)
      .send({ title: 'private' });
    aConvId = r.body.id;
  });

  it('userB gets 403 when reading userA conversation', async () => {
    const r = await request(app).get(`/api/memory/conversations/${aConvId}`)
      .set('Cookie', userB.cookie);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CONVERSATION_FORBIDDEN');
  });

  it('userB gets 403 when writing to userA conversation', async () => {
    const r = await request(app).post(`/api/memory/conversations/${aConvId}/messages`)
      .set('Cookie', userB.cookie)
      .send({ role: 'user', content: 'intrude' });
    expect(r.status).toBe(403);
  });

  it('userB gets 403 when deleting userA conversation', async () => {
    const r = await request(app).delete(`/api/memory/conversations/${aConvId}`)
      .set('Cookie', userB.cookie);
    expect(r.status).toBe(403);
  });
});

describe('Memory API · validation', () => {
  it('rejects invalid role with 400 VALIDATION_FAILED', async () => {
    const c = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({});
    const id = c.body.id;
    const r = await request(app).post(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie)
      .send({ role: 'bot', content: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects empty content with 400', async () => {
    const c = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie).send({});
    const id = c.body.id;
    const r = await request(app).post(`/api/memory/conversations/${id}/messages`)
      .set('Cookie', userA.cookie)
      .send({ role: 'user', content: '' });
    expect(r.status).toBe(400);
  });

  it('rejects title > 200 chars with 400', async () => {
    const r = await request(app).post('/api/memory/conversations')
      .set('Cookie', userA.cookie)
      .send({ title: 'x'.repeat(201) });
    expect(r.status).toBe(400);
  });
});
```

**关于 helper 调整**:上面 `buildTestApp` / `ctx.services.auth.createUser` 是通用假设,实际要按 `test/e2e/auth.e2e.test.ts` 里的套路来。如果 S1.1 e2e 通过 `pnpm user:create` CLI + 登录走完整流程,这里也照抄即可。不要引入新的 helper 范式。

- [ ] **Step 3: 跑测试**

```bash
pnpm test:e2e test/e2e/memory.e2e.test.ts
```

Expected:全部 PASS(约 11-12 条)。

- [ ] **Step 4: Commit**

```bash
git add test/e2e/memory.e2e.test.ts
git commit -m "test(s2): e2e suite for memory API (CRUD, isolation, validation)"
```

---

## Task 20 · 跑全量测试 + typecheck

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

Expected:所有用例 PASS(S1.1 11 个 + memory 新增)。

- [ ] **Step 3: 全量 integration**

```bash
pnpm test:integration
```

Expected:PASS(S1.1 既有 + memory 新增)。

- [ ] **Step 4: 全量 e2e**

```bash
pnpm test:e2e
```

Expected:PASS。

- [ ] **Step 5: 如果全绿,无 commit 必要,直接进入 Task 21**

---

## Task 21 · 手工 Smoke 清单文档

**Files:**
- Create: `docs/qa/s2-memory-manual-checklist.md`

- [ ] **Step 1: 创建文件**

```markdown
# S2 · 手工 smoke 清单

发版前逐项执行,全部通过才能 merge 到 main。

前提:`.env` 指向目标环境;`pnpm db:migrate` 已执行;`pnpm user:create` 创建好账号 A、B;`pnpm dev` 已启动服务。

变量:`$BASE` = 服务 URL(如 `http://localhost:3000`);`$CA` = userA 的 Cookie jar;`$CB` = userB 的 Cookie jar。

## 1. 前置

- [ ] `curl $BASE/healthz` → `{"ok":true}`
- [ ] `curl -c $CA -X POST $BASE/api/auth/login -H 'content-type: application/json' -d '{"email":"a@mem.test","password":"..."}'` → 200
- [ ] 同理登录 userB → `$CB` 生效

## 2. 鉴权

- [ ] `curl $BASE/api/memory/conversations` (无 cookie) → 401 `UNAUTHENTICATED`
- [ ] `curl -b $CA $BASE/api/memory/conversations` → 200(空列表或现有数据)

## 3. Conversation CRUD

- [ ] `curl -b $CA -X POST $BASE/api/memory/conversations -H 'content-type: application/json' -d '{"title":"smoke"}'` → 201,响应含 id/userId/title/createdAt/updatedAt
- [ ] 记下返回的 `id` 为 `$CID`
- [ ] `curl -b $CA $BASE/api/memory/conversations/$CID` → 200
- [ ] `curl -b $CA $BASE/api/memory/conversations` → items 数组含 `$CID`
- [ ] 空 title: `curl -b $CA -X POST $BASE/api/memory/conversations -d '{}'` → 201,title 为 null

## 4. Messages

- [ ] `curl -b $CA -X POST $BASE/api/memory/conversations/$CID/messages -H 'content-type: application/json' -d '{"role":"user","content":"hi"}'` → 201
- [ ] 第二条 role=ai:`-d '{"role":"ai","content":"hello"}'` → 201
- [ ] `curl -b $CA $BASE/api/memory/conversations/$CID/messages` → 两条按插入顺序(ASC)
- [ ] 再读 conversation:updatedAt 应晚于 createdAt
- [ ] 非法 role:`-d '{"role":"bot","content":"x"}'` → 400 `VALIDATION_FAILED`
- [ ] 空 content:`-d '{"role":"user","content":""}'` → 400

## 5. 跨用户隔离

- [ ] `curl -b $CB $BASE/api/memory/conversations/$CID` → 403 `CONVERSATION_FORBIDDEN`
- [ ] `curl -b $CB -X POST $BASE/api/memory/conversations/$CID/messages -d '{"role":"user","content":"x"}'` → 403
- [ ] `curl -b $CB -X DELETE $BASE/api/memory/conversations/$CID` → 403

## 6. 删除 + 级联

- [ ] `curl -b $CA -X DELETE $BASE/api/memory/conversations/$CID` → 204
- [ ] 再读 `$CID` → 404 `CONVERSATION_NOT_FOUND`
- [ ] SQL 直查 `SELECT COUNT(*) FROM messages WHERE conversation_id = '$CID'` → 0(级联删成功)

## 7. 日志核查

- [ ] 在 `pnpm dev` 的终端执行上述流程,确认:
  - 没有堆栈泄漏
  - 日志不出现任何消息 `content` 字段的明文(`grep 'hello' server.log` 应只在审计事件里出现,不在记忆 API 的日志 payload 里)
  - 每个请求都有 `requestId`
```

- [ ] **Step 2: Commit**

```bash
git add docs/qa/s2-memory-manual-checklist.md
git commit -m "docs(s2): add manual smoke checklist"
```

---

## Task 22 · 同步 spec 修正

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-s2-memory-core-design.md`

> 实现过程中两处和现有代码的表达差异需要回写 spec,保持 spec/代码一致。

- [ ] **Step 1: 修正错误响应结构(§ 4 公共约定 + 各端点示例)**

找到 § 4 "公共约定"里这行:

```
错误响应格式:`{ "code": "...", "message": "..." }`(对齐 S1.1);`VALIDATION_FAILED` 额外带 `details`
```

改成:

```
错误响应格式:`{ "error": { "code": "...", "message": "..." } }`(对齐 S1.1 的 errorHandler);`VALIDATION_FAILED` 的 `error` 对象额外带 `details` 字段
```

- [ ] **Step 2: 移除 `InvalidMessageRoleError`**

§ 4 错误码清单里删除这行:

```
| `INVALID_MESSAGE_ROLE` | 400 | zod 之后的兜底,理论不触发 |
```

§ 7 的错误类代码块里删除 `InvalidMessageRoleError` 定义。

- [ ] **Step 3: 修正 "req.user" 的表述(§ 十)**

找到 § 10 "与 S1.1 的连接点" 第二行:

```
- `requireSession` middleware 直接 import 复用,注入 `req.user.id`
```

改为:

```
- `requireSession` middleware 直接 import 复用,注入 `res.locals.auth: { userId, sessionId }`
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-23-s2-memory-core-design.md
git commit -m "docs(s2): align spec with actual code (error envelope, res.locals.auth)"
```

---

## Task 23 · README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 把"当前状态"章节的列表项补上 M1**

找到 README.md 里:

```markdown
## 当前状态

- M0 地基:S1.1 账户与身份 ✅(仅一个账号,走 CLI 创建)
```

改为:

```markdown
## 当前状态

- M0 地基:S1.1 账户与身份 ✅(仅一个账号,走 CLI 创建)
- M1 记忆骨架:S2.1 记忆存储 + S2.4 回忆 API ✅(对话文本存取,无内容搜索)
```

- [ ] **Step 2: 在 API 区域加一段(如果 README 有 API 简介章节)**

如果现有 README 里 Quick Start 之后没有 API 示例章节,跳过此步。有的话追加:

```markdown
### 记忆 API(M1)

所有端点都需要先登录拿 Cookie。

- `POST /api/memory/conversations` 创建会话
- `GET /api/memory/conversations` 列出会话
- `POST /api/memory/conversations/:id/messages` 追加消息
- `GET /api/memory/conversations/:id/messages` 读取消息
- `DELETE /api/memory/conversations/:id` 删除会话(级联消息)

详见 `docs/superpowers/specs/2026-04-23-s2-memory-core-design.md` 和 `docs/qa/s2-memory-manual-checklist.md`。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: mark M1 complete in README + add memory API overview"
```

---

## Task 24 · 分支收尾(不推送,不合并)

**Files:** 无

- [ ] **Step 1: `git log --oneline main..HEAD` 检查 commit 结构清晰**

```bash
git log --oneline main..HEAD
```

Expected:看到约 20 条 `feat(s2)/test(s2)/docs(s2)/refactor(s2)` 前缀的 commit,时间顺序清晰。

- [ ] **Step 2: 确认 working tree 干净**

```bash
git status
```

Expected:`nothing to commit, working tree clean`。

- [ ] **Step 3: 报告给用户**

交付物清单:
- 分支:`feature/s2-memory-core`,未合并到 main
- 新增:`src/modules/memory/` 完整模块、migration、3 档测试、smoke 清单、spec 修正、README 更新
- 下一步由用户决定:走 smoke → merge → 进入 M2 还是继续 S2 后续(S2.2/S2.3/S2.5 是 M3 的事,不在当前范围)

---

## Self-Review 记录

Plan 写完后做过以下检查:

1. **Spec 覆盖**:
   - § 1 目标:Task 10-15(service + controller + routes + 装配)
   - § 2 决策表 14 项:每一项都在对应 Task 里落地
   - § 3 架构 & 目录:Task 3-15 按此结构建
   - § 4 数据模型:Task 2 migration
   - § 5 接口:Task 7-14
   - § 6 HTTP 契约 6 端点:Task 13 (controller) + Task 14 (routes) + Task 19 (e2e)
   - § 7 错误处理:Task 4 + 20
   - § 8 测试策略:Task 5, 10-12, 16-19
   - § 9 非功能性:贯穿(事务、索引、日志)
   - § 11 实现顺序:Task 顺序严格对齐

2. **类型一致性**:`MemoryService` 构造器 3 参数(conversations / messages / db),Task 10 定义后 Task 11/12/15 一致引用;`insert` 方法带可选 `executor` 的签名 Task 8/9 对齐 Task 12 调用点。

3. **无 placeholder**:每个 step 都有具体代码块或具体命令 + 预期输出。两处"按实际 setup.ts 调整"的提示(Task 16/19)是技术要求,因为 S1.1 setup helper 的实际签名需要工程师现场确认,给足了上下文(cat 命令 + 假设名 + 改动范围)。

4. **Spec 修正作为 Task 22 集中处理**:避免实现过程反复改 spec。
