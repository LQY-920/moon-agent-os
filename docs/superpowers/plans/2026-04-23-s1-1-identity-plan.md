# S1.1 账户与身份 (Identity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 moon-agent-os 的账户与身份子系统(M0 最小可用版本):单账号 Node.js + TypeScript + Express 5 + MySQL 8 后端,含邮箱/密码登录、多设备会话、限流、审计事件 bus、CLI 创建账户、会话清理任务,端到端跑通并通过测试。

**Architecture:** Express 5 应用按 `routes → controllers → services → repositories → db` 单向依赖;会话用 opaque token + 服务端 sessions 表 + HttpOnly Cookie;密码用 argon2id;限流用进程内存双键(IP + email);审计用 Node `EventEmitter`,M0 订阅者仅打日志。

**Tech Stack:** Node.js 20+ · TypeScript 5 · Express 5 · MySQL 8 · Kysely + mysql2 · argon2 · zod · pino · ulid · helmet · cookie-parser · node-cron · vitest · supertest · testcontainers

**Spec 来源:** `docs/superpowers/specs/2026-04-23-s1-1-identity-design.md`(以下简称 "spec")。本 plan 的所有决策与 spec 保持一致;spec §12 未决项按用户拍板固定为:扁平单仓、单进程、CLI 挂 npm script、限流用内置 `express-rate-limit` store(见 Task 10)。

**前置要求(读者必须在本机具备):**
- Node.js ≥ 20(`node -v`)
- pnpm ≥ 9(`pnpm -v`)— 若无:`npm i -g pnpm`
- Docker Desktop 运行中(集成测试用 testcontainers 起 MySQL)
- 本机可访问互联网(拉 npm 包和 MySQL 镜像)

**约定:**
- 所有命令在 moon-agent-os 仓库根目录执行,除非显式说明
- 所有代码块展示的是**完整文件内容**,除非标注 `// ...existing...`
- 每个 Task 末尾都有 commit;commit 前请确认 `pnpm typecheck` 与相关 test 全绿
- 日期戳 `20260423` 在 migration 和 plan 文件名里使用;实现时若日期变了**不要**改这个戳(保持时间顺序)

---

## Task 0: 创建 feature 分支

**Files:** 无

- [ ] **Step 1: 从 main 切出 feature 分支**

Run:
```bash
git -C D:/moon-ai-work/moon-agent-os checkout main
git -C D:/moon-ai-work/moon-agent-os pull
git -C D:/moon-ai-work/moon-agent-os checkout -b feature/s1-1-identity
```

Expected output 末行:`Switched to a new branch 'feature/s1-1-identity'`

- [ ] **Step 2: 确认分支正确**

Run:
```bash
git -C D:/moon-ai-work/moon-agent-os branch --show-current
```

Expected output:
```
feature/s1-1-identity
```

---

## Task 1: 初始化 Node.js 项目 + TypeScript

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: 初始化 package.json**

Run:
```bash
cd D:/moon-ai-work/moon-agent-os
pnpm init
```

然后**完全覆写** `package.json` 为以下内容:

```json
{
  "name": "moon-agent-os",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "node --enable-source-maps dist/main.js",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:e2e": "vitest run test/e2e",
    "db:migrate": "tsx scripts/migrate.ts up",
    "db:rollback": "tsx scripts/migrate.ts down",
    "user:create": "tsx src/cli/user-create.ts"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: 写 tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noImplicitAny": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": false,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "migrations/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 写 .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
.vitest-cache/
```

- [ ] **Step 4: 写 .env.example**

Create `.env.example`:

```
NODE_ENV=development
APP_ORIGIN=http://localhost:3000
PORT=3000

DATABASE_URL=mysql://root:password@localhost:3306/moon_agent_os

SESSION_COOKIE_NAME=mao_sess
SESSION_MAX_AGE_DAYS=30
SESSION_SLIDING_UPDATE_MINUTES=1

RATE_LIMIT_IP_WINDOW_MIN=10
RATE_LIMIT_IP_MAX=20
RATE_LIMIT_EMAIL_WINDOW_MIN=10
RATE_LIMIT_EMAIL_MAX=5

LOG_LEVEL=info
```

- [ ] **Step 5: 安装运行时依赖**

Run:
```bash
pnpm add express@^5 cookie-parser helmet express-rate-limit kysely mysql2 argon2 zod pino pino-pretty ulid node-cron @zxcvbn-ts/core @zxcvbn-ts/language-common @zxcvbn-ts/language-en
```

Expected output 末行:含 `Done in`。

- [ ] **Step 6: 安装开发依赖**

Run:
```bash
pnpm add -D typescript tsx @types/node @types/express @types/cookie-parser @types/node-cron vitest @vitest/ui supertest @types/supertest testcontainers @testcontainers/mysql
```

Expected output 末行:含 `Done in`。

- [ ] **Step 7: 验证 typecheck 空项目能过**

Run:
```bash
pnpm typecheck
```

Expected: 空输出,exit code 0(因为 src/ 还没有文件)。如果报"no inputs found",改 tsconfig `include` 增加容忍或等到 Step 下一个 Task 再验证。若报错,先创建 `src/placeholder.ts` 内容为 `export {};`,过后 Task 2 会覆盖。

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json .gitignore .env.example
git commit -m "chore(s1.1): init Node.js + TypeScript + Express scaffolding"
```

---

## Task 2: 搭 core/config.ts (Zod 校验环境变量)

**Files:**
- Create: `src/core/config.ts`
- Test: `test/unit/core/config.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/core/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('core/config', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // 清掉所有 APP 前缀 env,重新设置
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('APP_') || k.startsWith('SESSION_') || k.startsWith('RATE_') || k === 'DATABASE_URL' || k === 'PORT' || k === 'LOG_LEVEL' || k === 'NODE_ENV') {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('loads valid config', async () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ORIGIN = 'http://localhost:3000';
    process.env.PORT = '3000';
    process.env.DATABASE_URL = 'mysql://root:password@localhost:3306/moon_agent_os';
    process.env.SESSION_COOKIE_NAME = 'mao_sess';
    process.env.SESSION_MAX_AGE_DAYS = '30';
    process.env.SESSION_SLIDING_UPDATE_MINUTES = '1';
    process.env.RATE_LIMIT_IP_WINDOW_MIN = '10';
    process.env.RATE_LIMIT_IP_MAX = '20';
    process.env.RATE_LIMIT_EMAIL_WINDOW_MIN = '10';
    process.env.RATE_LIMIT_EMAIL_MAX = '5';
    process.env.LOG_LEVEL = 'info';

    const { loadConfig } = await import('../../../src/core/config.ts');
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.session.maxAgeDays).toBe(30);
  });

  it('throws when required env missing', async () => {
    // 不设置 DATABASE_URL
    process.env.NODE_ENV = 'development';
    const { loadConfig } = await import('../../../src/core/config.ts');
    expect(() => loadConfig()).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认 FAIL**

Run:
```bash
pnpm test:unit -- test/unit/core/config.test.ts
```

Expected: FAIL,原因含 `Cannot find module` 或类似(文件不存在)。

- [ ] **Step 3: 实现 config.ts**

Create `src/core/config.ts`:

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  APP_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().startsWith('mysql://'),
  SESSION_COOKIE_NAME: z.string().min(1),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive(),
  SESSION_SLIDING_UPDATE_MINUTES: z.coerce.number().int().positive(),
  RATE_LIMIT_IP_WINDOW_MIN: z.coerce.number().int().positive(),
  RATE_LIMIT_IP_MAX: z.coerce.number().int().positive(),
  RATE_LIMIT_EMAIL_WINDOW_MIN: z.coerce.number().int().positive(),
  RATE_LIMIT_EMAIL_MAX: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
});

export type Config = {
  nodeEnv: 'development' | 'production' | 'test';
  appOrigin: string;
  port: number;
  databaseUrl: string;
  session: {
    cookieName: string;
    maxAgeDays: number;
    slidingUpdateMinutes: number;
  };
  rateLimit: {
    ipWindowMin: number;
    ipMax: number;
    emailWindowMin: number;
    emailMax: number;
  };
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
};

export function loadConfig(): Config {
  const parsed = ConfigSchema.parse(process.env);
  return {
    nodeEnv: parsed.NODE_ENV,
    appOrigin: parsed.APP_ORIGIN,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    session: {
      cookieName: parsed.SESSION_COOKIE_NAME,
      maxAgeDays: parsed.SESSION_MAX_AGE_DAYS,
      slidingUpdateMinutes: parsed.SESSION_SLIDING_UPDATE_MINUTES,
    },
    rateLimit: {
      ipWindowMin: parsed.RATE_LIMIT_IP_WINDOW_MIN,
      ipMax: parsed.RATE_LIMIT_IP_MAX,
      emailWindowMin: parsed.RATE_LIMIT_EMAIL_WINDOW_MIN,
      emailMax: parsed.RATE_LIMIT_EMAIL_MAX,
    },
    logLevel: parsed.LOG_LEVEL,
  };
}
```

- [ ] **Step 4: 运行测试确认 PASS**

Run:
```bash
pnpm test:unit -- test/unit/core/config.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts test/unit/core/config.test.ts
git commit -m "feat(s1.1): add core/config with zod env validation"
```

---

## Task 3: 搭 core/logger.ts (pino + redact)

**Files:**
- Create: `src/core/logger.ts`

- [ ] **Step 1: 实现 logger**

Create `src/core/logger.ts`:

```typescript
import pino from 'pino';

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    redact: {
      paths: [
        'password',
        'newPassword',
        'oldPassword',
        'token',
        'mao_sess',
        'req.headers.authorization',
        'req.headers.cookie',
        'password_hash',
        '*.password',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
```

- [ ] **Step 2: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0,空输出。

- [ ] **Step 3: Commit**

```bash
git add src/core/logger.ts
git commit -m "feat(s1.1): add core/logger (pino + redact)"
```

---

## Task 4: 搭 core/errors.ts (AppError 基类)

**Files:**
- Create: `src/core/errors.ts`
- Test: `test/unit/core/errors.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/core/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AppError } from '../../../src/core/errors.ts';

describe('AppError', () => {
  it('carries code, status and message', () => {
    class NotFoundError extends AppError {
      code = 'NOT_FOUND' as const;
      status = 404 as const;
    }
    const err = new NotFoundError('resource missing');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toBe('resource missing');
  });

  it('preserves stack trace', () => {
    class BoomError extends AppError {
      code = 'BOOM' as const;
      status = 500 as const;
    }
    const err = new BoomError('boom');
    expect(err.stack).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试 FAIL**

Run:
```bash
pnpm test:unit -- test/unit/core/errors.test.ts
```

Expected: FAIL,`Cannot find module` 相关。

- [ ] **Step 3: 实现 errors.ts**

Create `src/core/errors.ts`:

```typescript
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}
```

- [ ] **Step 4: 运行测试 PASS**

Run:
```bash
pnpm test:unit -- test/unit/core/errors.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: Commit**

```bash
git add src/core/errors.ts test/unit/core/errors.test.ts
git commit -m "feat(s1.1): add core/errors AppError base class"
```

---

## Task 5: 搭 core/db.ts (Kysely + mysql2 连接池)

**Files:**
- Create: `src/core/db.ts`

- [ ] **Step 1: 定义数据库类型并实现连接**

Create `src/core/db.ts`:

```typescript
import { Kysely, MysqlDialect } from 'kysely';
import { createPool, type Pool } from 'mysql2';

export type UserRow = {
  id: string;
  email: string;
  email_verified: number;       // 0/1
  password_hash: string | null;
  display_name: string;
  status: 'active' | 'disabled' | 'deleted';
  created_at: Date;
  updated_at: Date;
};

export type IdentityRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  metadata: unknown | null;
  created_at: Date;
};

export type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

export type LoginAttemptRow = {
  id: number;
  email: string | null;
  ip: string;
  success: number;
  reason: string | null;
  attempted_at: Date;
};

export type Database = {
  users: UserRow;
  identities: IdentityRow;
  sessions: SessionRow;
  login_attempts: LoginAttemptRow;
};

export function createDb(databaseUrl: string): { db: Kysely<Database>; pool: Pool } {
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    dateStrings: false,
    timezone: 'Z',
  });
  const db = new Kysely<Database>({
    dialect: new MysqlDialect({ pool: async () => pool }),
  });
  return { db, pool };
}
```

- [ ] **Step 2: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 3: Commit**

```bash
git add src/core/db.ts
git commit -m "feat(s1.1): add core/db with Kysely + mysql2"
```

---

## Task 6: 写 migration + migrate 脚本

**Files:**
- Create: `migrations/20260423_001_init_identity.ts`
- Create: `scripts/migrate.ts`

- [ ] **Step 1: 写 migration 文件**

Create `migrations/20260423_001_init_identity.ts`:

```typescript
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id              CHAR(26)      NOT NULL,
      email           VARCHAR(255)  NOT NULL,
      email_verified  TINYINT(1)    NOT NULL DEFAULT 0,
      password_hash   VARCHAR(255)  NULL,
      display_name    VARCHAR(64)   NOT NULL,
      status          ENUM('active','disabled','deleted') NOT NULL DEFAULT 'active',
      created_at      DATETIME(3)   NOT NULL,
      updated_at      DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE identities (
      id                CHAR(26)     NOT NULL,
      user_id           CHAR(26)     NOT NULL,
      provider          VARCHAR(32)  NOT NULL,
      provider_user_id  VARCHAR(255) NOT NULL,
      metadata          JSON         NULL,
      created_at        DATETIME(3)  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_provider_puid (provider, provider_user_id),
      KEY idx_user (user_id),
      CONSTRAINT fk_identities_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE sessions (
      id            CHAR(26)      NOT NULL,
      user_id       CHAR(26)      NOT NULL,
      token_hash    CHAR(64)      NOT NULL,
      user_agent    VARCHAR(512)  NULL,
      ip            VARCHAR(64)   NULL,
      created_at    DATETIME(3)   NOT NULL,
      last_seen_at  DATETIME(3)   NOT NULL,
      expires_at    DATETIME(3)   NOT NULL,
      revoked_at    DATETIME(3)   NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_token_hash (token_hash),
      KEY idx_user_active (user_id, revoked_at),
      KEY idx_expires (expires_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE login_attempts (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email         VARCHAR(255)    NULL,
      ip            VARCHAR(64)     NOT NULL,
      success       TINYINT(1)      NOT NULL,
      reason        VARCHAR(32)     NULL,
      attempted_at  DATETIME(3)     NOT NULL,
      PRIMARY KEY (id),
      KEY idx_ip_time (ip, attempted_at),
      KEY idx_email_time (email, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS login_attempts`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS identities`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
}
```

- [ ] **Step 2: 写 migrate 脚本**

Create `scripts/migrate.ts`:

```typescript
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely';
import { loadConfig } from '../src/core/config.ts';
import { createDb } from '../src/core/db.ts';

async function main() {
  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    console.error('Usage: migrate.ts <up|down>');
    process.exit(1);
  }

  const cfg = loadConfig();
  const { db, pool } = createDb(cfg.databaseUrl);

  const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  });

  const { error, results } = direction === 'up'
    ? await migrator.migrateToLatest()
    : await migrator.migrateDown();

  for (const r of results ?? []) {
    if (r.status === 'Success') {
      console.log(`[${direction}] ${r.migrationName}: ${r.status}`);
    } else {
      console.error(`[${direction}] ${r.migrationName}: ${r.status}`);
    }
  }

  if (error) {
    console.error('Migration failed:', error);
    await db.destroy();
    pool.end();
    process.exit(1);
  }

  await db.destroy();
  pool.end();
}

main();
```

- [ ] **Step 3: 本地起 MySQL(用 Docker)**

Run:
```bash
docker run -d --name moon-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=password -e MYSQL_DATABASE=moon_agent_os mysql:8
```

Wait 约 15 秒后:

```bash
docker exec moon-mysql mysqladmin ping -h localhost -u root -ppassword
```

Expected: `mysqld is alive`。

- [ ] **Step 4: 复制 .env 并执行迁移**

Run:
```bash
cp .env.example .env
pnpm db:migrate
```

Expected output 含:
```
[up] 20260423_001_init_identity: Success
```

- [ ] **Step 5: 验证表已建**

Run:
```bash
docker exec moon-mysql mysql -u root -ppassword moon_agent_os -e "SHOW TABLES;"
```

Expected output 含四行表名:`identities`, `login_attempts`, `sessions`, `users`(外加 `kysely_migration` 和 `kysely_migration_lock` 两张 Kysely 内置表)。

- [ ] **Step 6: Commit**

```bash
git add migrations/20260423_001_init_identity.ts scripts/migrate.ts
git commit -m "feat(s1.1): add initial migration (users/identities/sessions/login_attempts)"
```

---

## Task 7: domain 层 (user/session/errors)

**Files:**
- Create: `src/modules/identity/domain/user.ts`
- Create: `src/modules/identity/domain/session.ts`
- Create: `src/modules/identity/domain/errors.ts`

- [ ] **Step 1: 写 user domain**

Create `src/modules/identity/domain/user.ts`:

```typescript
export type UserStatus = 'active' | 'disabled' | 'deleted';

export type User = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type UserWithPassword = User & {
  passwordHash: string | null;
};
```

- [ ] **Step 2: 写 session domain**

Create `src/modules/identity/domain/session.ts`:

```typescript
export type Session = {
  id: string;
  userId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};
```

- [ ] **Step 3: 写 identity 特化错误**

Create `src/modules/identity/domain/errors.ts`:

```typescript
import { AppError } from '../../../core/errors.ts';

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly status = 401;
  constructor() { super('邮箱或密码错误'); }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;
  constructor() { super('未登录或会话已失效'); }
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  constructor(readonly retryAfterSec: number) { super(`请稍后再试(${retryAfterSec}s)`); }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
  constructor(msg = '资源不存在') { super(msg); }
}

export class WeakPasswordError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor(readonly details: Record<string, string>) { super('密码不符合安全要求'); }
}

export class EmailAlreadyUsedError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor() { super('邮箱已被注册'); }
}
```

- [ ] **Step 4: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/domain/
git commit -m "feat(s1.1): add identity domain (user/session/errors)"
```

---

## Task 8: events.ts (审计事件 bus)

**Files:**
- Create: `src/modules/identity/events.ts`
- Test: `test/unit/identity/events.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/identity/events.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { authEvents, type AuthEvent } from '../../../src/modules/identity/events.ts';

describe('authEvents', () => {
  it('emits login_success to subscribers', () => {
    const handler = vi.fn();
    authEvents.on('login_success', handler);
    const ev: Extract<AuthEvent, { type: 'login_success' }> = {
      type: 'login_success',
      userId: '01HX',
      sessionId: '01HY',
      ip: '1.2.3.4',
      ua: 'UA',
    };
    authEvents.emit('login_success', ev);
    expect(handler).toHaveBeenCalledWith(ev);
    authEvents.off('login_success', handler);
  });

  it('subscriber error does not throw from emit (caller isolation)', () => {
    const bad = () => { throw new Error('boom'); };
    authEvents.on('logout', bad);
    // Node EventEmitter default: 同步订阅者的异常会上抛,我们期望**订阅者自己包 try**
    // 本测试验证"如果订阅者不包 try,emit 确实会抛",以此约束 identity 内部订阅者必须包 try
    expect(() => authEvents.emit('logout', { type: 'logout', userId: 'u', sessionId: 's' })).toThrow('boom');
    authEvents.off('logout', bad);
  });
});
```

- [ ] **Step 2: 运行 FAIL**

Run:
```bash
pnpm test:unit -- test/unit/identity/events.test.ts
```

Expected: FAIL (`Cannot find module`)。

- [ ] **Step 3: 实现 events.ts**

Create `src/modules/identity/events.ts`:

```typescript
import { EventEmitter } from 'node:events';

export type AuthEvent =
  | { type: 'login_success';    userId: string; sessionId: string; ip?: string; ua?: string }
  | { type: 'login_failure';    email?: string; ip?: string; reason: 'bad_password' | 'unknown_email' | 'rate_limited' }
  | { type: 'logout';           userId: string; sessionId: string }
  | { type: 'session_revoked';  userId: string; sessionId: string; by: 'user' | 'password_change' | 'expiry' }
  | { type: 'password_changed'; userId: string }
  | { type: 'user_created';     userId: string; via: 'cli' | 'register' };

export const authEvents = new EventEmitter();
```

- [ ] **Step 4: 运行测试 PASS**

Run:
```bash
pnpm test:unit -- test/unit/identity/events.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/events.ts test/unit/identity/events.test.ts
git commit -m "feat(s1.1): add identity events bus (AuthEvent + EventEmitter)"
```

---

## Task 9: schema.ts (Zod 入参/出参)

**Files:**
- Create: `src/modules/identity/schema.ts`

- [ ] **Step 1: 实现 schema**

Create `src/modules/identity/schema.ts`:

```typescript
import { z } from 'zod';

export const LoginInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z.object({
  oldPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const SessionIdParam = z.object({
  id: z.string().length(26),
});

export const CreateUserInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(256),
  displayName: z.string().min(1).max(64),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;
```

- [ ] **Step 2: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/schema.ts
git commit -m "feat(s1.1): add identity zod schemas"
```

---

## Task 10: password.service (argon2id + zxcvbn)

**Files:**
- Create: `src/modules/identity/services/password.service.ts`
- Test: `test/unit/identity/password.service.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test/unit/identity/password.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PasswordService } from '../../../src/modules/identity/services/password.service.ts';

const svc = new PasswordService();

describe('PasswordService', () => {
  it('hash then verify success', async () => {
    const hash = await svc.hash('CorrectHorseBatteryStaple');
    expect(hash).toMatch(/^\$argon2id\$/);
    const ok = await svc.verify(hash, 'CorrectHorseBatteryStaple');
    expect(ok).toBe(true);
  });

  it('verify wrong password returns false', async () => {
    const hash = await svc.hash('CorrectHorseBatteryStaple');
    const ok = await svc.verify(hash, 'wrong-password-xxxx');
    expect(ok).toBe(false);
  });

  it('checkStrength rejects short password', () => {
    expect(() => svc.checkStrength('short')).toThrow();
  });

  it('checkStrength rejects dictionary weak password', () => {
    expect(() => svc.checkStrength('password1234')).toThrow();
  });

  it('checkStrength accepts strong password', () => {
    expect(() => svc.checkStrength('CorrectHorseBatteryStaple9!')).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行 FAIL**

Run:
```bash
pnpm test:unit -- test/unit/identity/password.service.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 password.service**

Create `src/modules/identity/services/password.service.ts`:

```typescript
import argon2 from 'argon2';
import { zxcvbnAsync, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { WeakPasswordError } from '../domain/errors.ts';

zxcvbnOptions.setOptions({
  dictionary: {
    ...zxcvbnCommon.dictionary,
    ...zxcvbnEn.dictionary,
  },
  graphs: zxcvbnCommon.adjacencyGraphs,
  translations: zxcvbnEn.translations,
});

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  checkStrength(plain: string): void {
    const details: Record<string, string> = {};
    if (plain.length < 12) {
      details.password = '密码至少 12 位';
      throw new WeakPasswordError(details);
    }
    // zxcvbn 同步一个简单子集:检查是否在前 10K 常见字典
    // 实际生产我们用 zxcvbnAsync,但同步版由 length + 简单启发足够 M0
    const common = ['password', 'password1', '12345678', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'abc12345'];
    const lower = plain.toLowerCase();
    if (common.some((c) => lower.includes(c))) {
      details.password = '密码过于常见,请使用更强的组合';
      throw new WeakPasswordError(details);
    }
  }

  async checkStrengthAsync(plain: string): Promise<void> {
    this.checkStrength(plain);
    const result = await zxcvbnAsync(plain);
    if (result.score < 2) {
      throw new WeakPasswordError({ password: '密码强度过低(zxcvbn score < 2)' });
    }
  }
}
```

- [ ] **Step 4: 运行测试 PASS**

Run:
```bash
pnpm test:unit -- test/unit/identity/password.service.test.ts
```

Expected: 5 passed。

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/services/password.service.ts test/unit/identity/password.service.test.ts
git commit -m "feat(s1.1): add password.service (argon2id + strength check)"
```

---

## Task 11: repositories (user / identity / session / login-attempt)

**Files:**
- Create: `src/modules/identity/repositories/user.repository.ts`
- Create: `src/modules/identity/repositories/identity.repository.ts`
- Create: `src/modules/identity/repositories/session.repository.ts`
- Create: `src/modules/identity/repositories/login-attempt.repository.ts`

- [ ] **Step 1: user.repository**

Create `src/modules/identity/repositories/user.repository.ts`:

```typescript
import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db.ts';
import type { User, UserWithPassword } from '../domain/user.ts';

function rowToUser(row: {
  id: string; email: string; email_verified: number; display_name: string;
  status: 'active' | 'disabled' | 'deleted'; created_at: Date; updated_at: Date;
}): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<UserWithPassword | null> {
    const row = await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    if (!row) return null;
    return { ...rowToUser(row), passwordHash: row.password_hash };
  }

  async insert(user: {
    id: string; email: string; passwordHash: string; displayName: string; now: Date;
  }): Promise<void> {
    await this.db.insertInto('users').values({
      id: user.id,
      email: user.email,
      email_verified: 0,
      password_hash: user.passwordHash,
      display_name: user.displayName,
      status: 'active',
      created_at: user.now,
      updated_at: user.now,
    }).execute();
  }

  async updatePasswordHash(id: string, hash: string, now: Date): Promise<void> {
    await this.db.updateTable('users')
      .set({ password_hash: hash, updated_at: now })
      .where('id', '=', id)
      .execute();
  }
}
```

- [ ] **Step 2: identity.repository**

Create `src/modules/identity/repositories/identity.repository.ts`:

```typescript
import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db.ts';

export class IdentityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insertPassword(id: string, userId: string, email: string, now: Date): Promise<void> {
    await this.db.insertInto('identities').values({
      id,
      user_id: userId,
      provider: 'password',
      provider_user_id: email,
      metadata: null,
      created_at: now,
    }).execute();
  }
}
```

- [ ] **Step 3: session.repository**

Create `src/modules/identity/repositories/session.repository.ts`:

```typescript
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../../core/db.ts';
import type { Session } from '../domain/session.ts';

function rowToSession(row: {
  id: string; user_id: string; user_agent: string | null; ip: string | null;
  created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
}): Session {
  return {
    id: row.id,
    userId: row.user_id,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class SessionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(s: {
    id: string; userId: string; tokenHash: string;
    userAgent: string | null; ip: string | null;
    now: Date; expiresAt: Date;
  }): Promise<void> {
    await this.db.insertInto('sessions').values({
      id: s.id, user_id: s.userId, token_hash: s.tokenHash,
      user_agent: s.userAgent, ip: s.ip,
      created_at: s.now, last_seen_at: s.now, expires_at: s.expiresAt, revoked_at: null,
    }).execute();
  }

  async findActiveByTokenHash(tokenHash: string): Promise<Session | null> {
    const row = await this.db.selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async findByIdForUser(id: string, userId: string): Promise<Session | null> {
    const row = await this.db.selectFrom('sessions')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async listActiveByUser(userId: string): Promise<Session[]> {
    const rows = await this.db.selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(rowToSession);
  }

  async touchLastSeen(id: string, now: Date): Promise<void> {
    await this.db.updateTable('sessions')
      .set({ last_seen_at: now })
      .where('id', '=', id)
      .execute();
  }

  async revokeById(id: string, now: Date): Promise<void> {
    await this.db.updateTable('sessions')
      .set({ revoked_at: now })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db.updateTable('sessions')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async deleteStale(before: Date): Promise<number> {
    const res = await this.db.deleteFrom('sessions')
      .where((eb) => eb.or([
        eb('expires_at', '<', before),
        eb('revoked_at', '<', before),
      ]))
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }
}
```

- [ ] **Step 4: login-attempt.repository**

Create `src/modules/identity/repositories/login-attempt.repository.ts`:

```typescript
import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db.ts';

export class LoginAttemptRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(a: {
    email: string | null; ip: string; success: boolean; reason: string | null; now: Date;
  }): Promise<void> {
    await this.db.insertInto('login_attempts').values({
      email: a.email,
      ip: a.ip,
      success: a.success ? 1 : 0,
      reason: a.reason,
      attempted_at: a.now,
    }).execute();
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const res = await this.db.deleteFrom('login_attempts')
      .where('attempted_at', '<', before)
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }
}
```

- [ ] **Step 5: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/repositories/
git commit -m "feat(s1.1): add identity repositories (user/identity/session/login-attempt)"
```

---

## Task 12: session.service

**Files:**
- Create: `src/modules/identity/services/session.service.ts`

- [ ] **Step 1: 实现 session.service**

Create `src/modules/identity/services/session.service.ts`:

```typescript
import * as crypto from 'node:crypto';
import { ulid } from 'ulid';
import type { SessionRepository } from '../repositories/session.repository.ts';
import type { Session } from '../domain/session.ts';
import { UnauthenticatedError } from '../domain/errors.ts';

export type SessionConfig = {
  maxAgeDays: number;
  slidingUpdateMinutes: number;
};

export type CreateSessionResult = { rawToken: string; session: Session };

export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    private readonly cfg: SessionConfig,
  ) {}

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async create(opts: { userId: string; ip: string | null; userAgent: string | null; now: Date }): Promise<CreateSessionResult> {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const id = ulid();
    const expiresAt = new Date(opts.now.getTime() + this.cfg.maxAgeDays * 86_400_000);
    await this.repo.insert({
      id, userId: opts.userId, tokenHash: this.hashToken(rawToken),
      userAgent: opts.userAgent, ip: opts.ip, now: opts.now, expiresAt,
    });
    const session: Session = {
      id, userId: opts.userId, userAgent: opts.userAgent, ip: opts.ip,
      createdAt: opts.now, lastSeenAt: opts.now, expiresAt, revokedAt: null,
    };
    return { rawToken, session };
  }

  async validateAndTouch(rawToken: string, now: Date): Promise<Session> {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.repo.findActiveByTokenHash(tokenHash);
    if (!session) throw new UnauthenticatedError();
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.repo.revokeById(session.id, now);
      throw new UnauthenticatedError();
    }
    const slidingMs = this.cfg.slidingUpdateMinutes * 60_000;
    if (now.getTime() - session.lastSeenAt.getTime() > slidingMs) {
      await this.repo.touchLastSeen(session.id, now);
    }
    return session;
  }

  async revokeSession(userId: string, sessionId: string, now: Date): Promise<'revoked' | 'not_found' | 'already_revoked'> {
    const existing = await this.repo.findByIdForUser(sessionId, userId);
    if (!existing) return 'not_found';
    if (existing.revokedAt) return 'already_revoked';
    await this.repo.revokeById(sessionId, now);
    return 'revoked';
  }

  async revokeAll(userId: string, now: Date): Promise<void> {
    await this.repo.revokeAllForUser(userId, now);
  }

  async list(userId: string): Promise<Session[]> {
    return this.repo.listActiveByUser(userId);
  }
}
```

- [ ] **Step 2: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/services/session.service.ts
git commit -m "feat(s1.1): add session.service (opaque token + sliding touch)"
```

---

## Task 13: auth.service

**Files:**
- Create: `src/modules/identity/services/auth.service.ts`

- [ ] **Step 1: 实现 auth.service**

Create `src/modules/identity/services/auth.service.ts`:

```typescript
import { ulid } from 'ulid';
import type { UserRepository } from '../repositories/user.repository.ts';
import type { IdentityRepository } from '../repositories/identity.repository.ts';
import type { LoginAttemptRepository } from '../repositories/login-attempt.repository.ts';
import type { PasswordService } from './password.service.ts';
import type { SessionService } from './session.service.ts';
import type { User } from '../domain/user.ts';
import { InvalidCredentialsError, EmailAlreadyUsedError, WeakPasswordError } from '../domain/errors.ts';
import { authEvents } from '../events.ts';

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly identities: IdentityRepository,
    private readonly attempts: LoginAttemptRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async login(opts: { email: string; password: string; ip: string; userAgent: string | null; now: Date }):
    Promise<{ user: User; rawToken: string; sessionId: string }>
  {
    const found = await this.users.findByEmail(opts.email);
    if (!found || !found.passwordHash || found.status !== 'active') {
      await this.attempts.insert({ email: opts.email, ip: opts.ip, success: false, reason: 'unknown_email', now: opts.now });
      authEvents.emit('login_failure', { type: 'login_failure', email: opts.email, ip: opts.ip, reason: 'unknown_email' });
      throw new InvalidCredentialsError();
    }
    const ok = await this.passwords.verify(found.passwordHash, opts.password);
    if (!ok) {
      await this.attempts.insert({ email: opts.email, ip: opts.ip, success: false, reason: 'bad_password', now: opts.now });
      authEvents.emit('login_failure', { type: 'login_failure', email: opts.email, ip: opts.ip, reason: 'bad_password' });
      throw new InvalidCredentialsError();
    }
    await this.attempts.insert({ email: opts.email, ip: opts.ip, success: true, reason: null, now: opts.now });
    const { rawToken, session } = await this.sessions.create({
      userId: found.id, ip: opts.ip, userAgent: opts.userAgent, now: opts.now,
    });
    authEvents.emit('login_success', {
      type: 'login_success', userId: found.id, sessionId: session.id, ip: opts.ip, ua: opts.userAgent ?? undefined,
    });
    const { passwordHash, ...user } = found;
    void passwordHash;
    return { user, rawToken, sessionId: session.id };
  }

  async logout(userId: string, sessionId: string, now: Date): Promise<void> {
    await this.sessions.revokeSession(userId, sessionId, now);
    authEvents.emit('logout', { type: 'logout', userId, sessionId });
    authEvents.emit('session_revoked', { type: 'session_revoked', userId, sessionId, by: 'user' });
  }

  async changePassword(opts: { userId: string; oldPassword: string; newPassword: string; ip: string; userAgent: string | null; now: Date }):
    Promise<{ rawToken: string; sessionId: string }>
  {
    const user = await this.users.findByEmail(''); // 无法只用 id 找带密码版:走 id 分支
    void user; // placeholder to satisfy lint; use findByIdWithPassword later
    // 用 findById 版本:我们这里改用内部扩展方法
    const fullUser = await this.findUserWithPasswordById(opts.userId);
    if (!fullUser || !fullUser.passwordHash) throw new InvalidCredentialsError();
    const ok = await this.passwords.verify(fullUser.passwordHash, opts.oldPassword);
    if (!ok) throw new InvalidCredentialsError();
    if (opts.oldPassword === opts.newPassword) {
      throw new WeakPasswordError({ password: '新密码不能与旧密码相同' });
    }
    this.passwords.checkStrength(opts.newPassword);
    const newHash = await this.passwords.hash(opts.newPassword);
    await this.users.updatePasswordHash(opts.userId, newHash, opts.now);
    await this.sessions.revokeAll(opts.userId, opts.now);
    const { rawToken, session } = await this.sessions.create({
      userId: opts.userId, ip: opts.ip, userAgent: opts.userAgent, now: opts.now,
    });
    authEvents.emit('password_changed', { type: 'password_changed', userId: opts.userId });
    authEvents.emit('session_revoked', { type: 'session_revoked', userId: opts.userId, sessionId: 'all', by: 'password_change' });
    return { rawToken, sessionId: session.id };
  }

  // 简易 helper:为 changePassword 提供 "按 id 查带密码" 的能力。
  // 实际生产:在 UserRepository 加 findByIdWithPassword 方法。本 M0 为了减少表面积,放这里。
  private async findUserWithPasswordById(id: string) {
    const user = await this.users.findById(id);
    if (!user) return null;
    // Kysely 直接再查一次 password_hash:依赖 users.findById 暴露的不包含 hash,额外单查
    // 为了 plan 可执行,实际落地时把 findByIdWithPassword 加到 UserRepository
    return user as typeof user & { passwordHash: string | null };
  }

  async register(opts: { email: string; password: string; displayName: string; via: 'cli' | 'register'; now: Date }): Promise<string> {
    const existing = await this.users.findByEmail(opts.email);
    if (existing) throw new EmailAlreadyUsedError();
    this.passwords.checkStrength(opts.password);
    const hash = await this.passwords.hash(opts.password);
    const userId = ulid();
    const identityId = ulid();
    await this.users.insert({
      id: userId, email: opts.email, passwordHash: hash, displayName: opts.displayName, now: opts.now,
    });
    await this.identities.insertPassword(identityId, userId, opts.email, opts.now);
    authEvents.emit('user_created', { type: 'user_created', userId, via: opts.via });
    return userId;
  }
}
```

> **Note:** 上面 `findUserWithPasswordById` 是一个 lint-passable 的临时 stub。实际要**修正为在 `UserRepository` 增加方法** —— 见 Task 13b。

- [ ] **Step 2: 修正 user.repository 添加 findByIdWithPassword**

**Modify** `src/modules/identity/repositories/user.repository.ts`,在 `UserRepository` 类里追加方法(放在 `findByEmail` 之后):

```typescript
  async findByIdWithPassword(id: string): Promise<UserWithPassword | null> {
    const row = await this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    return { ...rowToUser(row), passwordHash: row.password_hash };
  }
```

并**修正** `auth.service.ts` 里的 `findUserWithPasswordById` 调用为:

```typescript
  private async findUserWithPasswordById(id: string) {
    return this.users.findByIdWithPassword(id);
  }
```

- [ ] **Step 3: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/services/auth.service.ts src/modules/identity/repositories/user.repository.ts
git commit -m "feat(s1.1): add auth.service (login/logout/register/changePassword)"
```

---

## Task 14: middleware (request-id / error-handler / require-session / rate-limit)

**Files:**
- Create: `src/middleware/request-id.ts`
- Create: `src/middleware/error-handler.ts`
- Create: `src/middleware/require-session.ts`
- Create: `src/middleware/rate-limit.ts`

- [ ] **Step 1: request-id**

Create `src/middleware/request-id.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ulid } from 'ulid';

export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[A-Za-z0-9_-]{1,64}$/.test(incoming) ? incoming : ulid();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  };
}
```

- [ ] **Step 2: error-handler**

Create `src/middleware/error-handler.ts`:

```typescript
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../core/errors.ts';
import type { Logger } from '../core/logger.ts';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const requestId = res.locals.requestId as string | undefined;
    if (err instanceof AppError) {
      const body: Record<string, unknown> = {
        error: { code: err.code, message: err.message },
      };
      if ('retryAfterSec' in err && typeof err.retryAfterSec === 'number') {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        (body.error as Record<string, unknown>).retryAfter = err.retryAfterSec;
      }
      if ('details' in err && err.details) {
        (body.error as Record<string, unknown>).details = err.details;
      }
      res.status(err.status).json(body);
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: '请求参数校验失败',
          details: err.flatten().fieldErrors,
        },
      });
      return;
    }
    logger.error({ err, requestId }, 'unhandled_error');
    res.status(500).json({
      error: { code: 'INTERNAL', message: '服务器内部错误', requestId },
    });
  };
}
```

- [ ] **Step 3: require-session**

Create `src/middleware/require-session.ts`:

```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SessionService } from '../modules/identity/services/session.service.ts';
import { UnauthenticatedError } from '../modules/identity/domain/errors.ts';

export type AuthCtx = { userId: string; sessionId: string };

export function requireSession(sessions: SessionService, cookieName: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const raw = cookies?.[cookieName];
      if (!raw) throw new UnauthenticatedError();
      const session = await sessions.validateAndTouch(raw, new Date());
      const auth: AuthCtx = { userId: session.userId, sessionId: session.id };
      res.locals.auth = auth;
      next();
    } catch (e) {
      next(e);
    }
  };
}
```

- [ ] **Step 4: rate-limit**

Create `src/middleware/rate-limit.ts`:

```typescript
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { RateLimitedError } from '../modules/identity/domain/errors.ts';

export type RateLimitConfig = {
  ipWindowMin: number; ipMax: number;
  emailWindowMin: number; emailMax: number;
};

export function buildLoginRateLimiters(cfg: RateLimitConfig): { byIp: RequestHandler; byEmail: RequestHandler } {
  const byIp = rateLimit({
    windowMs: cfg.ipWindowMin * 60_000,
    limit: cfg.ipMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? 'unknown',
    skipSuccessfulRequests: true,
    handler: (_req, _res, next, options) => {
      const retry = Math.ceil(options.windowMs / 1000);
      next(new RateLimitedError(retry));
    },
  });
  const byEmail = rateLimit({
    windowMs: cfg.emailWindowMin * 60_000,
    limit: cfg.emailMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      return typeof body?.email === 'string' ? body.email.toLowerCase() : 'unknown';
    },
    skipSuccessfulRequests: true,
    handler: (_req, _res, next, options) => {
      const retry = Math.ceil(options.windowMs / 1000);
      next(new RateLimitedError(retry));
    },
  });
  return { byIp, byEmail };
}
```

- [ ] **Step 5: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 6: Commit**

```bash
git add src/middleware/
git commit -m "feat(s1.1): add express middlewares (request-id/error/session/rate-limit)"
```

---

## Task 15: controllers (auth / me)

**Files:**
- Create: `src/modules/identity/controllers/auth.controller.ts`
- Create: `src/modules/identity/controllers/me.controller.ts`

- [ ] **Step 1: auth.controller**

Create `src/modules/identity/controllers/auth.controller.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { LoginInput } from '../schema.ts';
import type { AuthService } from '../services/auth.service.ts';
import type { AuthCtx } from '../../../middleware/require-session.ts';

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookieName: string,
    private readonly maxAgeDays: number,
    private readonly isProd: boolean,
  ) {}

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = LoginInput.parse(req.body);
      const result = await this.auth.login({
        email: input.email,
        password: input.password,
        ip: req.ip ?? 'unknown',
        userAgent: req.header('user-agent') ?? null,
        now: new Date(),
      });
      res.cookie(this.cookieName, result.rawToken, {
        httpOnly: true,
        secure: this.isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: this.maxAgeDays * 86_400_000,
      });
      res.status(200).json({ user: result.user });
    } catch (e) { next(e); }
  };

  logout = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      await this.auth.logout(auth.userId, auth.sessionId, new Date());
      res.clearCookie(this.cookieName, { path: '/' });
      res.status(204).send();
    } catch (e) { next(e); }
  };

  registerNotImplemented = (_req: Request, res: Response) => {
    res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'M0 不开放注册,请联系管理员用 CLI 创建账户' } });
  };
}
```

- [ ] **Step 2: me.controller**

Create `src/modules/identity/controllers/me.controller.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ChangePasswordInput, SessionIdParam } from '../schema.ts';
import type { AuthService } from '../services/auth.service.ts';
import type { SessionService } from '../services/session.service.ts';
import type { UserRepository } from '../repositories/user.repository.ts';
import type { AuthCtx } from '../../../middleware/require-session.ts';
import { NotFoundError, UnauthenticatedError } from '../domain/errors.ts';

export class MeController {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly cookieName: string,
    private readonly maxAgeDays: number,
    private readonly isProd: boolean,
  ) {}

  get = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = res.locals.auth as AuthCtx;
      const user = await this.users.findById(userId);
      if (!user) throw new UnauthenticatedError();
      res.status(200).json({ user });
    } catch (e) { next(e); }
  };

  listSessions = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const list = await this.sessions.list(auth.userId);
      res.status(200).json({
        sessions: list.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
          current: s.id === auth.sessionId,
        })),
      });
    } catch (e) { next(e); }
  };

  revokeSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = SessionIdParam.parse(req.params);
      const result = await this.sessions.revokeSession(auth.userId, id, new Date());
      if (result === 'not_found') throw new NotFoundError('会话不存在');
      if (id === auth.sessionId) res.clearCookie(this.cookieName, { path: '/' });
      res.status(204).send();
    } catch (e) { next(e); }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const input = ChangePasswordInput.parse(req.body);
      const result = await this.auth.changePassword({
        userId: auth.userId,
        oldPassword: input.oldPassword,
        newPassword: input.newPassword,
        ip: req.ip ?? 'unknown',
        userAgent: req.header('user-agent') ?? null,
        now: new Date(),
      });
      res.cookie(this.cookieName, result.rawToken, {
        httpOnly: true,
        secure: this.isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: this.maxAgeDays * 86_400_000,
      });
      res.status(204).send();
    } catch (e) { next(e); }
  };
}
```

- [ ] **Step 3: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/controllers/
git commit -m "feat(s1.1): add identity controllers (auth/me)"
```

---

## Task 16: routes.ts (装配路由)

**Files:**
- Create: `src/modules/identity/routes.ts`

- [ ] **Step 1: 实现 routes**

Create `src/modules/identity/routes.ts`:

```typescript
import { Router, type RequestHandler } from 'express';
import type { AuthController } from './controllers/auth.controller.ts';
import type { MeController } from './controllers/me.controller.ts';

export function buildIdentityRoutes(opts: {
  authCtrl: AuthController;
  meCtrl: MeController;
  requireSession: RequestHandler;
  loginRateLimiters: { byIp: RequestHandler; byEmail: RequestHandler };
}): Router {
  const r = Router();
  const { authCtrl, meCtrl, requireSession, loginRateLimiters } = opts;

  r.post('/auth/login', loginRateLimiters.byIp, loginRateLimiters.byEmail, authCtrl.login);
  r.post('/auth/logout', requireSession, authCtrl.logout);
  r.post('/auth/register', authCtrl.registerNotImplemented);
  r.post('/auth/verify-email', authCtrl.registerNotImplemented);
  r.post('/auth/password-reset/request', authCtrl.registerNotImplemented);
  r.post('/auth/password-reset/confirm', authCtrl.registerNotImplemented);

  r.get('/me', requireSession, meCtrl.get);
  r.get('/me/sessions', requireSession, meCtrl.listSessions);
  r.delete('/me/sessions/:id', requireSession, meCtrl.revokeSession);
  r.post('/me/password', requireSession, meCtrl.changePassword);

  return r;
}
```

- [ ] **Step 2: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/routes.ts
git commit -m "feat(s1.1): add identity routes"
```

---

## Task 17: main.ts (Express app + 事件订阅 + cron + 健康检查)

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: 实现 main.ts**

Create `src/main.ts`:

```typescript
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cron from 'node-cron';
import { loadConfig } from './core/config.ts';
import { createLogger } from './core/logger.ts';
import { createDb } from './core/db.ts';
import { requestId } from './middleware/request-id.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { requireSession } from './middleware/require-session.ts';
import { buildLoginRateLimiters } from './middleware/rate-limit.ts';
import { UserRepository } from './modules/identity/repositories/user.repository.ts';
import { IdentityRepository } from './modules/identity/repositories/identity.repository.ts';
import { SessionRepository } from './modules/identity/repositories/session.repository.ts';
import { LoginAttemptRepository } from './modules/identity/repositories/login-attempt.repository.ts';
import { PasswordService } from './modules/identity/services/password.service.ts';
import { SessionService } from './modules/identity/services/session.service.ts';
import { AuthService } from './modules/identity/services/auth.service.ts';
import { AuthController } from './modules/identity/controllers/auth.controller.ts';
import { MeController } from './modules/identity/controllers/me.controller.ts';
import { buildIdentityRoutes } from './modules/identity/routes.ts';
import { authEvents } from './modules/identity/events.ts';

export async function buildApp() {
  const cfg = loadConfig();
  const isProd = cfg.nodeEnv === 'production';
  const logger = createLogger(cfg.logLevel, !isProd);
  const { db, pool } = createDb(cfg.databaseUrl);

  const users = new UserRepository(db);
  const identities = new IdentityRepository(db);
  const sessionsRepo = new SessionRepository(db);
  const attempts = new LoginAttemptRepository(db);
  const passwords = new PasswordService();
  const sessions = new SessionService(sessionsRepo, {
    maxAgeDays: cfg.session.maxAgeDays,
    slidingUpdateMinutes: cfg.session.slidingUpdateMinutes,
  });
  const auth = new AuthService(users, identities, attempts, passwords, sessions);

  const authCtrl = new AuthController(auth, cfg.session.cookieName, cfg.session.maxAgeDays, isProd);
  const meCtrl = new MeController(users, sessions, auth, cfg.session.cookieName, cfg.session.maxAgeDays, isProd);
  const loginRateLimiters = buildLoginRateLimiters(cfg.rateLimit);

  // 审计事件订阅(M0 仅日志)
  const safeLog = (name: string) => (ev: unknown) => {
    try { logger.info({ event: ev }, `auth_event.${name}`); } catch { /* 防御 */ }
  };
  authEvents.on('login_success', safeLog('login_success'));
  authEvents.on('login_failure', safeLog('login_failure'));
  authEvents.on('logout', safeLog('logout'));
  authEvents.on('session_revoked', safeLog('session_revoked'));
  authEvents.on('password_changed', safeLog('password_changed'));
  authEvents.on('user_created', safeLog('user_created'));

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(requestId());
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

  app.use('/api', buildIdentityRoutes({
    authCtrl, meCtrl,
    requireSession: requireSession(sessions, cfg.session.cookieName),
    loginRateLimiters,
  }));

  app.use(errorHandler(logger));

  // 清理任务(测试环境不启动 cron)
  let cronTask: cron.ScheduledTask | null = null;
  if (cfg.nodeEnv !== 'test') {
    cronTask = cron.schedule('0 3 * * *', async () => {
      const now = new Date();
      const sessionCutoff = new Date(now.getTime() - 30 * 86_400_000);
      const attemptCutoff = new Date(now.getTime() - 90 * 86_400_000);
      const sDeleted = await sessionsRepo.deleteStale(sessionCutoff);
      const aDeleted = await attempts.deleteOlderThan(attemptCutoff);
      logger.info({ sessionsDeleted: sDeleted, attemptsDeleted: aDeleted }, 'cron_cleanup');
    });
  }

  async function shutdown() {
    if (cronTask) cronTask.stop();
    await db.destroy();
    pool.end();
  }

  return { app, shutdown, logger, cfg };
}

async function main() {
  const { app, logger, cfg } = await buildApp();
  const server = app.listen(cfg.port, () => {
    logger.info({ port: cfg.port }, 'server_started');
  });
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('bootstrap failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: 验证 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 3: 起本地服务烟雾测试**

Run:
```bash
pnpm dev
```

Expected: 日志中出现 `server_started` 以及端口。另开一个 shell:

```bash
curl http://localhost:3000/healthz
```

Expected: `{"ok":true}`。

停掉 dev:Ctrl-C。

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(s1.1): wire Express app with identity routes + cron + events"
```

---

## Task 18: CLI (user-create)

**Files:**
- Create: `src/cli/user-create.ts`

- [ ] **Step 1: 实现 user-create**

Create `src/cli/user-create.ts`:

```typescript
import * as readline from 'node:readline/promises';
import { loadConfig } from '../core/config.ts';
import { createDb } from '../core/db.ts';
import { UserRepository } from '../modules/identity/repositories/user.repository.ts';
import { IdentityRepository } from '../modules/identity/repositories/identity.repository.ts';
import { LoginAttemptRepository } from '../modules/identity/repositories/login-attempt.repository.ts';
import { SessionRepository } from '../modules/identity/repositories/session.repository.ts';
import { PasswordService } from '../modules/identity/services/password.service.ts';
import { SessionService } from '../modules/identity/services/session.service.ts';
import { AuthService } from '../modules/identity/services/auth.service.ts';
import { CreateUserInput } from '../modules/identity/schema.ts';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function readSecret(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const displayName = args.name;
  if (!email || !displayName) {
    console.error('Usage: pnpm user:create --email=<email> --name=<display-name>');
    process.exit(1);
  }
  const password = await readSecret('Password (输入后回车,不会写入 shell history): ');

  const parsed = CreateUserInput.safeParse({ email, password, displayName });
  if (!parsed.success) {
    console.error('参数校验失败:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  const cfg = loadConfig();
  const { db, pool } = createDb(cfg.databaseUrl);
  const users = new UserRepository(db);
  const identities = new IdentityRepository(db);
  const attempts = new LoginAttemptRepository(db);
  const sessionsRepo = new SessionRepository(db);
  const passwords = new PasswordService();
  const sessions = new SessionService(sessionsRepo, {
    maxAgeDays: cfg.session.maxAgeDays,
    slidingUpdateMinutes: cfg.session.slidingUpdateMinutes,
  });
  const auth = new AuthService(users, identities, attempts, passwords, sessions);

  try {
    const id = await auth.register({
      email: parsed.data.email,
      password: parsed.data.password,
      displayName: parsed.data.displayName,
      via: 'cli',
      now: new Date(),
    });
    console.log(`Created user ${id} (${parsed.data.email})`);
  } catch (err) {
    console.error('创建失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await db.destroy();
    pool.end();
  }
}

main();
```

- [ ] **Step 2: 测试 CLI**

确保 MySQL 已启动、migration 已跑。Run:

```bash
pnpm user:create --email=lvyang@example.com --name=Lvyang
```

在提示处输入 ≥12 位且不含常见词的密码(如 `MyS3cureP@ssword`)。

Expected: `Created user 01HX... (lvyang@example.com)`。

- [ ] **Step 3: 验证数据库**

Run:
```bash
docker exec moon-mysql mysql -u root -ppassword moon_agent_os -e "SELECT id, email, display_name, status FROM users;"
```

Expected 输出一行账号记录。

- [ ] **Step 4: Commit**

```bash
git add src/cli/user-create.ts
git commit -m "feat(s1.1): add CLI user-create"
```

---

## Task 19: 集成测试 (repositories + migration)

**Files:**
- Create: `test/integration/setup.ts`
- Create: `test/integration/session.repository.int.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: vitest.config.ts**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    environment: 'node',
  },
});
```

- [ ] **Step 2: 集成测试 setup(启 testcontainers)**

Create `test/integration/setup.ts`:

```typescript
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { Kysely, MysqlDialect, Migrator, FileMigrationProvider } from 'kysely';
import { createPool } from 'mysql2';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../../src/core/db.ts';

export type TestDbCtx = {
  container: StartedMySqlContainer;
  db: Kysely<Database>;
  pool: ReturnType<typeof createPool>;
  destroy: () => Promise<void>;
};

export async function startTestDb(): Promise<TestDbCtx> {
  const container = await new MySqlContainer('mysql:8').withDatabase('moon_test').withRootPassword('root').start();
  const url = `mysql://root:root@${container.getHost()}:${container.getPort()}/moon_test`;
  const pool = createPool({ uri: url, connectionLimit: 5 });
  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });
  const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const migrator = new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder }) });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
  return {
    container, db, pool,
    destroy: async () => { await db.destroy(); pool.end(); await container.stop(); },
  };
}
```

- [ ] **Step 3: session.repository 集成测试**

Create `test/integration/session.repository.int.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ulid } from 'ulid';
import { startTestDb, type TestDbCtx } from './setup.ts';
import { UserRepository } from '../../src/modules/identity/repositories/user.repository.ts';
import { SessionRepository } from '../../src/modules/identity/repositories/session.repository.ts';

let ctx: TestDbCtx;
let users: UserRepository;
let sessions: SessionRepository;
let userId: string;

beforeAll(async () => {
  ctx = await startTestDb();
  users = new UserRepository(ctx.db);
  sessions = new SessionRepository(ctx.db);
  userId = ulid();
  await users.insert({
    id: userId, email: 'int@example.com', passwordHash: 'fake-hash',
    displayName: 'Int', now: new Date(),
  });
});

afterAll(async () => {
  await ctx.destroy();
});

describe('SessionRepository (integration)', () => {
  it('insert then find active by token hash', async () => {
    const now = new Date();
    const id = ulid();
    await sessions.insert({
      id, userId, tokenHash: 'a'.repeat(64),
      userAgent: 'UA', ip: '1.1.1.1',
      now, expiresAt: new Date(now.getTime() + 86_400_000),
    });
    const s = await sessions.findActiveByTokenHash('a'.repeat(64));
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(userId);
  });

  it('revoked session is not found as active', async () => {
    const now = new Date();
    const id = ulid();
    await sessions.insert({
      id, userId, tokenHash: 'b'.repeat(64),
      userAgent: null, ip: null, now, expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await sessions.revokeById(id, new Date());
    const s = await sessions.findActiveByTokenHash('b'.repeat(64));
    expect(s).toBeNull();
  });

  it('deleteStale removes expired rows', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    await sessions.insert({
      id: ulid(), userId, tokenHash: 'c'.repeat(64),
      userAgent: null, ip: null, now: old, expiresAt: old,
    });
    const before = new Date(Date.now() - 90 * 86_400_000);
    const deleted = await sessions.deleteStale(before);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: 运行集成测试**

Run(确认 Docker Desktop 已启动):

```bash
pnpm test:integration
```

Expected: 3 passed。首次运行会拉 MySQL 镜像,可能 1-2 分钟。

- [ ] **Step 5: Commit**

```bash
git add test/integration/ vitest.config.ts
git commit -m "test(s1.1): integration tests for session.repository + migration"
```

---

## Task 20: E2E 测试 (登录 / /me / 会话 / 改密码)

**Files:**
- Create: `test/e2e/auth.e2e.test.ts`

- [ ] **Step 1: E2E 测试(挂真实 app 在 testcontainers 上)**

Create `test/e2e/auth.e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { Kysely, MysqlDialect, Migrator, FileMigrationProvider } from 'kysely';
import { createPool, type Pool } from 'mysql2';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Database } from '../../src/core/db.ts';

let container: StartedMySqlContainer;
let app: Express;
let shutdown: () => Promise<void>;

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8').withDatabase('moon_e2e').withRootPassword('root').start();
  const url = `mysql://root:root@${container.getHost()}:${container.getPort()}/moon_e2e`;

  const pool: Pool = createPool({ uri: url, connectionLimit: 5 });
  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });
  const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  const migrator = new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder }) });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
  await db.destroy(); pool.end();

  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.PORT = '0';
  process.env.DATABASE_URL = url;
  process.env.SESSION_COOKIE_NAME = 'mao_sess';
  process.env.SESSION_MAX_AGE_DAYS = '30';
  process.env.SESSION_SLIDING_UPDATE_MINUTES = '1';
  process.env.RATE_LIMIT_IP_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_IP_MAX = '1000';      // e2e 不关心限流
  process.env.RATE_LIMIT_EMAIL_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_EMAIL_MAX = '1000';
  process.env.LOG_LEVEL = 'warn';

  const { buildApp } = await import('../../src/main.ts');
  const built = await buildApp();
  app = built.app;
  shutdown = built.shutdown;

  // 用 AuthService 直接 register 一个账号
  const { AuthService } = await import('../../src/modules/identity/services/auth.service.ts');
  const { UserRepository } = await import('../../src/modules/identity/repositories/user.repository.ts');
  const { IdentityRepository } = await import('../../src/modules/identity/repositories/identity.repository.ts');
  const { LoginAttemptRepository } = await import('../../src/modules/identity/repositories/login-attempt.repository.ts');
  const { SessionRepository } = await import('../../src/modules/identity/repositories/session.repository.ts');
  const { SessionService } = await import('../../src/modules/identity/services/session.service.ts');
  const { PasswordService } = await import('../../src/modules/identity/services/password.service.ts');
  const pool2 = createPool({ uri: url, connectionLimit: 2 });
  const db2 = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool2 }) });
  const passwords = new PasswordService();
  const sessions = new SessionService(new SessionRepository(db2), { maxAgeDays: 30, slidingUpdateMinutes: 1 });
  const svc = new AuthService(
    new UserRepository(db2),
    new IdentityRepository(db2),
    new LoginAttemptRepository(db2),
    passwords,
    sessions,
  );
  await svc.register({
    email: 'e2e@example.com', password: 'E2e-Test-Password-!!', displayName: 'E2E', via: 'cli', now: new Date(),
  });
  await db2.destroy(); pool2.end();
}, 120_000);

afterAll(async () => {
  await shutdown();
  await container.stop();
}, 60_000);

describe('auth e2e', () => {
  it('login → /me → logout flow', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Test-Password-!!' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const me = await request(app).get('/api/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('e2e@example.com');

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const afterLogout = await request(app).get('/api/me').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('login with wrong password returns 401 INVALID_CREDENTIALS (not leaking email existence)', async () => {
    const res1 = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'wrong-password' });
    expect(res1.status).toBe(401);
    expect(res1.body.error.code).toBe('INVALID_CREDENTIALS');

    const res2 = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(res2.status).toBe(401);
    expect(res2.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('change password revokes all sessions and issues a new one', async () => {
    const loginA = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Test-Password-!!' });
    const cookieA = loginA.headers['set-cookie'];
    const loginB = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'E2e-Test-Password-!!' });
    const cookieB = loginB.headers['set-cookie'];

    const change = await request(app).post('/api/me/password')
      .set('Cookie', cookieA)
      .send({ oldPassword: 'E2e-Test-Password-!!', newPassword: 'New-Strong-Password-!!' });
    expect(change.status).toBe(204);
    const cookieAnew = change.headers['set-cookie'];

    // 旧 A cookie 失效
    const oldA = await request(app).get('/api/me').set('Cookie', cookieA);
    expect(oldA.status).toBe(401);
    // B 也失效
    const oldB = await request(app).get('/api/me').set('Cookie', cookieB);
    expect(oldB.status).toBe(401);
    // 新 cookie 可用
    const newA = await request(app).get('/api/me').set('Cookie', cookieAnew);
    expect(newA.status).toBe(200);
  });

  it('revoke someone else session returns 404', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'e2e@example.com', password: 'New-Strong-Password-!!' });
    const cookie = login.headers['set-cookie'];
    const res = await request(app).delete('/api/me/sessions/01HXAAAAAAAAAAAAAAAAAAAA').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('register endpoint returns 501 NOT_IMPLEMENTED in M0', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'xxx', displayName: 'x' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
```

- [ ] **Step 2: 运行 E2E**

Run:
```bash
pnpm test:e2e
```

Expected: 5 passed(首次运行拉镜像耗时较长,预留 3-5 分钟)。

- [ ] **Step 3: Commit**

```bash
git add test/e2e/
git commit -m "test(s1.1): e2e suite for login/logout/me/change-password/404/501"
```

---

## Task 21: 收尾 · 全量测试 + smoke 清单文档

**Files:**
- Create: `docs/qa/s1-1-manual-checklist.md`

- [ ] **Step 1: 跑全量测试**

Run:
```bash
pnpm test
```

Expected: unit + integration + e2e 全绿。如有失败,回到对应 Task 修。

- [ ] **Step 2: 写 smoke 清单**

Create `docs/qa/s1-1-manual-checklist.md`:

```markdown
# S1.1 · 手工 smoke 清单

发版前逐项执行,全部通过才能 merge 到 main。

前提:`.env` 指向目标环境;`pnpm db:migrate` 已执行;`pnpm user:create` 创建好账号。

## 1. 健康检查
- [ ] `curl $BASE/healthz` → `{"ok":true}`

## 2. 登录基本流
- [ ] 用正确密码登录 → 200,响应含 user;`Set-Cookie: mao_sess=...; HttpOnly`
- [ ] 用错误密码 → 401 `INVALID_CREDENTIALS`
- [ ] 用不存在的邮箱 → 401 `INVALID_CREDENTIALS`(与错误密码**外显一致**)

## 3. /me
- [ ] 携带 cookie → 200,返回 user
- [ ] 不带 cookie → 401 `UNAUTHENTICATED`
- [ ] 带无效 cookie → 401 `UNAUTHENTICATED`

## 4. 多设备会话
- [ ] A 设备登录,B 设备登录 → GET /api/me/sessions 两条记录
- [ ] A 上 DELETE `/api/me/sessions/<B.id>` → 204
- [ ] B 下次请求 → 401

## 5. 改密码
- [ ] 提供错误旧密码 → 400/401
- [ ] 提供过弱新密码(含 "password123" 子串)→ 400 `VALIDATION_FAILED`
- [ ] 正确提供 → 204,响应有新 Set-Cookie
- [ ] 所有旧会话失效(老 cookie 401)
- [ ] 新 cookie 可用

## 6. 限流
- [ ] 同一 IP 连续错密码 > 阈值 → 429,响应头 `Retry-After` 正常

## 7. 501 占位
- [ ] POST `/api/auth/register` → 501 `NOT_IMPLEMENTED`
- [ ] POST `/api/auth/verify-email` → 501
- [ ] POST `/api/auth/password-reset/request` → 501
- [ ] POST `/api/auth/password-reset/confirm` → 501

## 8. 日志
- [ ] 登录成功后日志出现 `auth_event.login_success`
- [ ] 登录失败后日志出现 `auth_event.login_failure` 且 `reason` 正确
- [ ] 日志中不出现明文 `password` 或 `mao_sess` 值
```

- [ ] **Step 3: 更新项目 README**

Modify `README.md`(完全覆写为):

```markdown
# moon-agent-os

## 项目介绍

AI 智能体操作系统实践项目。日抛型软件 + 按日进化。

详细愿景见 `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`。

## 当前状态

- M0 地基:S1.1 账户与身份 ✅(仅一个账号,走 CLI 创建)

## 快速开始

```bash
# 1. 安装
pnpm install

# 2. 配环境
cp .env.example .env  # 按需改 DATABASE_URL 等

# 3. 启 MySQL(本地开发用 Docker)
docker run -d --name moon-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=password -e MYSQL_DATABASE=moon_agent_os mysql:8

# 4. 建表
pnpm db:migrate

# 5. 创建账号(仅 M0 阶段走 CLI)
pnpm user:create --email=you@example.com --name=Yourname

# 6. 启服务
pnpm dev
```

## 测试

```bash
pnpm test          # 全量(需要 Docker Desktop 跑起来)
pnpm test:unit     # 仅单元
pnpm test:integration
pnpm test:e2e
```

## 技术栈

Node.js 20 · TypeScript · Express 5 · MySQL 8 · Kysely · argon2 · Vitest · testcontainers
```

- [ ] **Step 4: Commit**

```bash
git add docs/qa/s1-1-manual-checklist.md README.md
git commit -m "docs(s1.1): add smoke checklist + update README"
```

- [ ] **Step 5: 推送分支(可选,询问用户)**

**不要自动推送**。完成时向用户确认:

> S1.1 实现完成,feature/s1-1-identity 分支有 21 个 commit。要不要:
> 1. 推到远程并发 PR
> 2. 本地 merge 到 main 再推
> 3. 先保持本地分支状态,等你 review

---

## 实现顺序摘要

```
Task 0  创建 feature 分支
Task 1  初始化脚手架
Task 2  config
Task 3  logger
Task 4  errors 基类
Task 5  db (Kysely + mysql2)
Task 6  migration + migrate 脚本 + 跑通
Task 7  domain 层
Task 8  events bus
Task 9  zod schemas
Task 10 password.service
Task 11 四个 repositories
Task 12 session.service
Task 13 auth.service
Task 14 middleware (4 个)
Task 15 controllers (2 个)
Task 16 routes
Task 17 main.ts (Express 装配)
Task 18 CLI
Task 19 集成测试
Task 20 E2E 测试
Task 21 smoke 清单 + README + 收尾
```

每个 Task 自身可独立验证(pnpm typecheck / 相关 test);完成 Task 17 后第一次可以 curl /healthz 看到服务启动;完成 Task 18 后 CLI 可用;完成 Task 20 后所有 API 行为被自动化覆盖。
