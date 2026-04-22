# S1.1 账户与身份 (Identity) · 设计文档

> 对应顶层愿景文档 `2026-04-22-moon-agent-os-vision-decomposition.md` 中 L1 治理底座的 S1.1 子系统。
> 本文档是该子系统的 **design（设计）** 层产物，不是实现计划。
> 下一步：进入 writing-plans 产出 plan.md 后再开始实现。

**生成日期**：2026-04-23
**适用里程碑**：M0（地基）
**关联子系统**：L2 记忆中枢（S2.x，依赖 users.id 作为归属主体）、L1 S1.3 审计（订阅本模块事件）

---

## 一、定位与边界

### 1.1 M0 现实目标

- **只服务一个账号（作者本人）** 把整条流水线从本地跑到公网 VPS。
- **代码和表结构按多用户平台形状预留**，将来接入客户时不推倒重来。
- **客户侧的注册/邀请/验证码等能力不在 M0 实现范围**，但所有相关数据模型、占位路由、扩展钩子要存在。
- **部署形态**：本地开发 + 远程 VPS / 云主机（公网可达），通过 `.env` 切换环境。

### 1.2 不在 S1.1 做的事（明确划出去）

| 事项 | 归属 |
|---|---|
| 角色/权限策略引擎 | S1.2 Policy |
| 审计事件的订阅与存储 | S1.3 Audit（S1.1 只发布事件） |
| 计费与配额采集 | S1.4 Billing |
| OAuth/SSO 具体 provider 接入 | 延后子系统（S1.1 只留接口层） |
| 邮箱发送服务（验证邮件、找回密码） | 延后（M0 只留占位路由） |
| 前端登录/设置页面 | 前端形态（L4）负责；本模块只提供 API |

---

## 二、关键决策

| 维度 | 决策 | 排除的替代 |
|---|---|---|
| 登录基线 | 仅邮箱+密码 | 手机号验证码、OAuth、固定 .env 账号 |
| 会话机制 | Opaque token + 服务端 sessions 表 + Cookie | JWT、JWT + refresh |
| Cookie 策略 | `HttpOnly` / `Secure`（prod）/ `SameSite=Lax`，同域部署 | 跨域 `SameSite=None`（延后） |
| 会话粒度 | 多设备 + 会话列表 + 单独踢下线 | 单设备排他、或仅支持多设备不做管理 UI |
| 密码哈希 | argon2id（OWASP 2024 平衡档） | bcrypt、scrypt |
| 限流 | 两层（按 IP + 按邮箱），仅计失败 | 账户锁定策略（易被 DoS） |
| 审计 | 模块内定义 EventEmitter，S1.3 再订阅 | 直接写审计表（会跨模块职责） |
| 注册入口 | CLI 创建账号；`/auth/register` 占位 501 | 公网开放注册（M0 只一个人，多出来一个爆破面） |
| 实现路径 | 自写 + 成熟库 | 托管服务（Auth0/Supabase）、一体化框架（Better-Auth/Lucia） |
| 技术栈 | Node.js + TypeScript + Express 5 + MySQL 8 | Python/FastAPI、Go、Java |
| 主键类型 | ULID（26 字符） | 自增 int、UUID v4 |
| 时间列 | `DATETIME(3)` 毫秒精度 | `TIMESTAMP`、`BIGINT` epoch |

---

## 三、项目结构

Identity 作为 `apps/api` 下一个自包含模块，对外只暴露三个文件的导出：

```
moon-agent-os/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── modules/
│       │   │   └── identity/
│       │   │       ├── routes.ts               # 装配 Express 路由
│       │   │       ├── controllers/            # HTTP 入口
│       │   │       │   ├── auth.controller.ts
│       │   │       │   └── me.controller.ts
│       │   │       ├── services/               # 业务用例
│       │   │       │   ├── auth.service.ts
│       │   │       │   ├── session.service.ts
│       │   │       │   └── password.service.ts
│       │   │       ├── repositories/           # Kysely 查询
│       │   │       │   ├── user.repository.ts
│       │   │       │   ├── session.repository.ts
│       │   │       │   ├── identity.repository.ts
│       │   │       │   └── login-attempt.repository.ts
│       │   │       ├── domain/                 # 纯类型/值对象/错误
│       │   │       │   ├── user.ts
│       │   │       │   ├── session.ts
│       │   │       │   └── errors.ts
│       │   │       ├── events.ts               # 审计事件定义 + EventEmitter
│       │   │       └── schema.ts               # Zod 入参/出参
│       │   ├── core/
│       │   │   ├── db.ts                       # MySQL 连接池（Kysely + mysql2）
│       │   │   ├── logger.ts                   # pino，含 redact 配置
│       │   │   ├── config.ts                   # .env 读取 + Zod 校验
│       │   │   └── errors.ts                   # 基类 AppError
│       │   ├── middleware/
│       │   │   ├── require-session.ts          # 守卫：取 token → 查会话 → 挂 ctx.user
│       │   │   ├── rate-limit.ts               # 限流工厂（IP/邮箱双键）
│       │   │   ├── request-id.ts
│       │   │   └── error-handler.ts            # 统一错误响应
│       │   ├── cli/
│       │   │   └── user-create.ts              # pnpm user:create 命令入口
│       │   └── main.ts
│       ├── migrations/
│       │   └── 20260423_001_init_identity.ts
│       ├── test/
│       │   ├── unit/
│       │   ├── integration/                    # testcontainers MySQL
│       │   └── e2e/                            # supertest
│       ├── package.json
│       └── tsconfig.json
└── packages/
    └── shared/                                 # 预留：未来前端/SDK 共享类型
```

**对外导出契约**（其他模块只能从这些点依赖 Identity）：

- `modules/identity/routes.ts` → 给 `main.ts` 挂载用
- `modules/identity/events.ts` → 给 S1.3 审计或其他订阅者
- `middleware/require-session.ts` → 给未来其他模块做路由守卫

**内部依赖方向**：`routes → controllers → services → repositories → db`，只下行，不反向。services 之间不互相调用；跨 service 复用逻辑抽到 `domain/` 里。

---

## 四、数据模型

### 4.1 表结构

```sql
-- users：账户主体，L2 记忆的归属主体
CREATE TABLE users (
  id              CHAR(26)      NOT NULL,
  email           VARCHAR(255)  NOT NULL,
  email_verified  TINYINT(1)    NOT NULL DEFAULT 0,
  password_hash   VARCHAR(255)  NULL,              -- 纯 OAuth 账户可为 NULL
  display_name    VARCHAR(64)   NOT NULL,
  status          ENUM('active','disabled','deleted') NOT NULL DEFAULT 'active',
  created_at      DATETIME(3)   NOT NULL,
  updated_at      DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- identities：账户与身份提供方的映射
-- M0 注册时写一行 provider='password'；未来 OAuth 只追加行
CREATE TABLE identities (
  id                CHAR(26)     NOT NULL,
  user_id           CHAR(26)     NOT NULL,
  provider          VARCHAR(32)  NOT NULL,        -- 'password' | 'github' | 'google' | ...
  provider_user_id  VARCHAR(255) NOT NULL,        -- password: user.email;  OAuth: provider.sub
  metadata          JSON         NULL,
  created_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_provider_puid (provider, provider_user_id),
  KEY idx_user (user_id),
  CONSTRAINT fk_identities_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- sessions：多设备会话
CREATE TABLE sessions (
  id            CHAR(26)      NOT NULL,
  user_id       CHAR(26)      NOT NULL,
  token_hash    CHAR(64)      NOT NULL,           -- sha256(原始 token) hex
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- login_attempts：登录审计 + 限流辅助（只写表，90 天后裁剪）
CREATE TABLE login_attempts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255)    NULL,
  ip            VARCHAR(64)     NOT NULL,
  success       TINYINT(1)      NOT NULL,
  reason        VARCHAR(32)     NULL,             -- bad_password | unknown_email | rate_limited
  attempted_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ip_time (ip, attempted_at),
  KEY idx_email_time (email, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.2 约定与理由

- **主键 ULID**：按时间自然排序，URL 安全，不泄露规模。
- **时间列统一 `DATETIME(3)`**：毫秒精度，审计够用；避免 `TIMESTAMP` 时区坑。
- **`password_hash` 允许 NULL**：为未来纯 OAuth 账户预留。
- **`sessions.token_hash` 只存哈希**：泄库时 token 不可逆推。
- **`sessions.revoked_at` 软删**：保留审计轨迹，30 天后由清理任务物理删除。
- **`login_attempts` 只写不更新**：纯追加日志，供审计与事后回溯分析；**不**参与限流判定（限流在内存，见 §7.3）。

### 4.3 迁移策略

- 用 Kysely migration，`apps/api/migrations/` 下按 `YYYYMMDD_NNN_<desc>.ts` 命名。
- 启动时 **不自动迁移**，手动执行 `pnpm --filter api db:migrate`（生产更安全）。
- 每个迁移必须成对提供 `up` 和 `down`。

---

## 五、API 契约

### 5.1 统一错误响应

所有非 2xx 返回这个结构（`VALIDATION_FAILED` 可带 `details`）：

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "邮箱或密码错误" } }
```

### 5.2 端点清单

| Method | Path | 认证 | M0 状态 |
|---|---|---|---|
| POST | `/api/auth/login` | 无 | ✅ 实现 |
| POST | `/api/auth/logout` | 需 | ✅ 实现 |
| GET | `/api/me` | 需 | ✅ 实现 |
| GET | `/api/me/sessions` | 需 | ✅ 实现 |
| DELETE | `/api/me/sessions/:id` | 需 | ✅ 实现 |
| POST | `/api/me/password` | 需 | ✅ 实现 |
| POST | `/api/auth/register` | 无 | ⛔ 返回 `501 NOT_IMPLEMENTED`，M0 由 CLI 替代 |
| POST | `/api/auth/verify-email` | 无 | ⛔ 501 |
| POST | `/api/auth/password-reset/request` | 无 | ⛔ 501 |
| POST | `/api/auth/password-reset/confirm` | 无 | ⛔ 501 |

### 5.3 注册走 CLI

```
pnpm --filter api user:create --email=<email> --name=<display-name>
# 命令行交互提示密码，不在参数中传，避免进入 shell history
```

理由：公网部署 M0 只有一个账号，开放 `/register` 等于多一个爆破面；CLI 一次性创建最安全。未来将 `/register` 从 501 改为真实现时，现有数据不受影响。

### 5.4 样例：登录

```
POST /api/auth/login
Body: { "email": "you@example.com", "password": "..." }

→ 200 Set-Cookie: mao_sess=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
   { "user": { "id": "01HXY...", "email": "...", "displayName": "..." } }

→ 400 { "error": { "code": "VALIDATION_FAILED", "message": "...", "details": {...} } }
→ 401 { "error": { "code": "INVALID_CREDENTIALS", "message": "邮箱或密码错误" } }
→ 429 { "error": { "code": "RATE_LIMITED", "message": "...", "retryAfter": 60 } }
```

**安全约定**：`401` 外显不区分"邮箱不存在"与"密码错误"（防枚举）；内部 `login_attempts.reason` 字段仍然区分 `bad_password` / `unknown_email`，供审计查询。

### 5.5 样例：/me

```
GET /api/me

→ 200 { "user": {
    "id": "01HXY...",
    "email": "you@example.com",
    "emailVerified": false,
    "displayName": "Lvyang",
    "status": "active",
    "createdAt": "2026-04-20T12:00:00.000Z"
  } }
→ 401 { "error": { "code": "UNAUTHENTICATED", "message": "未登录或会话已失效" } }
```

### 5.6 样例：会话列表

```
GET /api/me/sessions

→ 200 { "sessions": [
    { "id": "01HXY...", "userAgent": "...", "ip": "...",
      "createdAt": "2026-04-20T12:00:00.000Z",
      "lastSeenAt": "2026-04-23T08:30:00.000Z",
      "expiresAt": "2026-05-20T12:00:00.000Z",
      "current": true },
    ...
  ] }
```

### 5.7 错误码字典

```
INVALID_CREDENTIALS       401  登录失败的唯一外显原因
UNAUTHENTICATED           401  没 Cookie 或 Cookie 无效
FORBIDDEN                 403  鉴权通过但无权
NOT_FOUND                 404  资源不存在（含"踢别人会话"场景，不泄露存在性）
VALIDATION_FAILED         400  Zod 校验失败，details 带字段级错误
RATE_LIMITED              429  限流，带 retryAfter
NOT_IMPLEMENTED           501  占位接口
INTERNAL                  500  兜底，带 requestId
```

---

## 六、会话机制

### 6.1 Token 生成

```ts
const raw  = crypto.randomBytes(32).toString('base64url'); // 43 字符，256 位熵
const hash = crypto.createHash('sha256').update(raw).digest('hex'); // 64 字符
```

- 原始 token 只出现在登录响应的 `Set-Cookie` 与客户端 Cookie。
- DB 只存 `token_hash`。
- `sessions.id`（ULID）用于对外操作（列出会话、踢会话）；`token_hash` 仅用于每次请求的会话验证。二者职责分开。

### 6.2 Cookie 参数

```
名字        : mao_sess
HttpOnly   : 是
Secure     : 生产为 true，本地开发按 NODE_ENV 切换
SameSite   : Lax
Path       : /
Max-Age    : 30 天（SESSION_MAX_AGE_DAYS 配置）
```

- M0 前后端同域部署，不跨站；将来分域时再切 `SameSite=None` + 引入 CSRF token。
- `app.set('trust proxy', 1)` 配合反向代理取真实 IP。

### 6.3 验证流程（`require-session` 中间件）

```
1. 从 Cookie 取原始 token；取不到 → 401 UNAUTHENTICATED
2. 计算 token_hash：SELECT sessions WHERE token_hash = ? AND revoked_at IS NULL
   命中 0 行 → 401 UNAUTHENTICATED
3. 检查 expires_at > now()；过期 → 标记 revoked_at=now()，返回 401
4. 滑动更新：如 last_seen_at 距今 > SESSION_SLIDING_UPDATE_MINUTES（默认 1 分钟），
   UPDATE last_seen_at = now()。避免每请求都写 DB。
5. 将 { userId, sessionId } 挂到 res.locals.auth，放行
```

### 6.4 过期策略

- **绝对过期 `expires_at`**：登录时设 30 天后，**不随活跃延长**。
- **滑动 `last_seen_at`**：仅标识"近期活跃"，不影响 `expires_at`。
- 不做"7 天不活跃自动登出"——与绝对过期概念正交，属于产品策略，M0 不加。

### 6.5 踢下线

```
DELETE /api/me/sessions/:id

1. SELECT * FROM sessions WHERE id = ? AND user_id = <当前>
   命中 0 行 → 404（会话不存在或属于别人，不区分这两种）
2. 若 revoked_at 已有值 → 204（幂等，不再发事件）
3. 否则 UPDATE sessions SET revoked_at = now() WHERE id = ?
   发布 session_revoked(by='user') 事件；返回 204
4. 如踢的是当前会话（id === res.locals.auth.sessionId），响应加 Set-Cookie 清空 mao_sess
```

### 6.6 改密码 = 踢光所有会话

```
POST /api/me/password
Body: { "oldPassword": "...", "newPassword": "..." }

1. 校验 oldPassword；失败 → 400 INVALID_CREDENTIALS
2. 校验 newPassword 符合密码策略；失败 → 400 VALIDATION_FAILED
3. UPDATE users SET password_hash = <new argon2id hash>
4. UPDATE sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL
5. 为本次请求创建新 session，返回新 Set-Cookie
6. 发布 password_changed + session_revoked(by='password_change') 事件
```

### 6.7 清理任务

- 用 `node-cron` 内嵌 api 进程：每天 03:00 执行
  ```sql
  DELETE FROM sessions
  WHERE expires_at < NOW() - INTERVAL 30 DAY
     OR revoked_at < NOW() - INTERVAL 30 DAY;
  ```
- 同时裁剪 `login_attempts`：`attempted_at < NOW() - INTERVAL 90 DAY`。
- 每次清理打 JSON 日志，含删除行数，便于观测。

### 6.8 明确不做

| 主动排除 | 原因 |
|---|---|
| Refresh token | opaque token + 滑动活跃时间已覆盖"长登录"需求 |
| CSRF token | 同域 + SameSite=Lax 足够抗 CSRF；分域后再加 |
| Session 绑定 IP/UA 硬校验 | 切换网络易误杀；只记录不强校验 |
| 并发会话数上限 | M0 不设限制，合规要求出现再加 |

---

## 七、安全与审计

### 7.1 密码哈希

```ts
// apps/api/src/modules/identity/services/password.service.ts
import argon2 from 'argon2';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,     // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;
```

- 参数与版本信息存在 `password_hash` 字符串自身（argon2 标准格式），无需额外列。
- 留 `rehashIfWeak(hash)` 钩子：登录成功后若检测 hash 参数低于当前配置，用新密码重哈希一次，实现零停机升参。

### 7.2 密码策略

- 最少 12 字符。
- 不强制复杂度（数字/符号/大写）—— NIST 2024 已明确反对。
- 用 `@zxcvbn-ts/core` 内置字典挡 10K 常见密码。
- 改密码时新旧不能相同。
- 不做"密码定期过期"。

### 7.3 限流

两层独立限流，任一命中即 429：

```
按 IP     : 20 次失败 / 10 分钟
按邮箱    :  5 次失败 / 10 分钟
```

- 仅计**失败**请求；成功不计数。
- 窗口用滑动而非固定（避免窗口边缘爆破）。
- 存储：M0 用内存（LRU），单进程够用；将来多实例时切到 MySQL 或 Redis。
- 响应头带 `Retry-After`。
- **不做账户锁定**：防止攻击者故意输错 DoS 真实用户。

### 7.4 审计事件（S1.3 前置钩子）

在 `modules/identity/events.ts` 定义一个极简 Event Bus：

```ts
import { EventEmitter } from 'node:events';

export type AuthEvent =
  | { type: 'login_success';    userId: string; sessionId: string; ip?: string; ua?: string }
  | { type: 'login_failure';    email?: string; ip?: string; reason: 'bad_password'|'unknown_email'|'rate_limited' }
  | { type: 'logout';           userId: string; sessionId: string }
  | { type: 'session_revoked';  userId: string; sessionId: string; by: 'user'|'password_change'|'expiry' }
  | { type: 'password_changed'; userId: string }
  | { type: 'user_created';     userId: string; via: 'cli'|'register' };

export const authEvents = new EventEmitter();
```

- Identity 模块内关键路径调 `authEvents.emit(event.type, event)`。
- M0 默认订阅者：仅 `logger.info({ event }, 'auth_event')`，结构化日志到 stdout。
- **订阅者必须 catch 自身异常**，不能让审计失败影响主路径。
- S1.3 实现时，只需在 `main.ts` 新增订阅者 `authEvents.on('*', auditRepo.write)`。

### 7.5 其他护栏

- `helmet()` 默认项全开（HSTS、XSS、frameguard）。
- CORS：M0 默认不开，同域部署；分域后再白名单。
- `express.json({ limit: '10kb' })`：auth 端点 payload 绝不会更大。
- 日志 redact 字段：`password`, `token`, `mao_sess`, `authorization`, `password_hash`。

### 7.6 配置项

```
# .env
NODE_ENV=development|production
APP_ORIGIN=https://moon-agent-os.example.com
DATABASE_URL=mysql://user:pass@host:3306/moon_agent_os

SESSION_COOKIE_NAME=mao_sess
SESSION_MAX_AGE_DAYS=30
SESSION_SLIDING_UPDATE_MINUTES=1

RATE_LIMIT_IP_WINDOW_MIN=10
RATE_LIMIT_IP_MAX=20
RATE_LIMIT_EMAIL_WINDOW_MIN=10
RATE_LIMIT_EMAIL_MAX=5

LOG_LEVEL=info
```

- `.env.example` 入 git，占位即可。
- `core/config.ts` 启动时用 Zod 校验；缺必填项直接进程退出，避免裸奔。

---

## 八、错误处理

三层策略：

```
1. domain 层抛 typed error：
     class InvalidCredentialsError extends AppError {
       code = 'INVALID_CREDENTIALS'; status = 401;
     }
2. service 层不 try/catch 这些 typed error，让其冒泡。
3. Express 错误中间件（main.ts 最末注册）统一翻译：
     err instanceof AppError → res.status(err.status).json({ error: {...} })
     ZodError                → 400 VALIDATION_FAILED + details
     其他                     → 500 INTERNAL（日志完整栈；响应仅含 requestId）
```

**约束**：
- 每请求生成 `x-request-id`（上游未传则自生），挂到 logger 上下文；500 响应带 `requestId` 便于反查。
- 绝不把原始 `error.message` 透给客户端——可能含 SQL 片段或栈信息。
- 数据库连接/事务失败在 repository 层写 `error` 日志后重抛，service 不吞。

---

## 九、测试策略

| 层 | 目标 | 工具 | 数据库 |
|---|---|---|---|
| 单元 | `domain/`, `services/` 的纯逻辑 | Vitest | 不起 DB，mock repository |
| 集成 | `repositories/` + migration 正确性 | Vitest + `testcontainers-mysql` | 真实 MySQL 容器，每 test 重建 |
| E2E | 端到端 HTTP 行为 | supertest | 真实 app + 真实 DB |

### 9.1 M0 通过条件

- `pnpm test` 绿：三层全跑。
- 不设硬覆盖率阈值，但以下安全路径必须有 case：
  - 密码错误返 401，响应体不区分邮箱/密码错。
  - 限流命中返 429，带 `Retry-After`。
  - 过期 session 第二次用立即失效。
  - 改密码后所有旧会话失效，新响应 Cookie 可用。
  - 踢别人（其他 user）的会话返 404 而非 403。
- 手工 smoke 清单：`docs/qa/s1-1-manual-checklist.md`（发版前执行）
  - 两台设备同登 → 在 A 踢 B → B 下一次请求 401。
  - A 改密码 → B 下一次请求 401；A 当前会话仍可用。

### 9.2 明确不做

- CI 内跑安全扫描器（ZAP/Burp） —— 单人项目过度。
- Fuzzing。
- Benchmark —— 登录 QPS 非 M0 瓶颈。

---

## 十、依赖清单（便于 plan.md 直接落）

**runtime**
- `express@^5`
- `kysely`, `mysql2`
- `argon2`
- `zod`
- `cookie-parser`
- `helmet`
- `express-rate-limit`（或等价自实现，接内存/Redis 两种后端）
- `pino`
- `ulid`
- `@zxcvbn-ts/core` + 常见密码字典 package
- `node-cron`

**dev**
- `typescript`, `tsx`
- `vitest`
- `supertest`
- `testcontainers`（仅集成测试用）
- `@types/*`

---

## 十一、演进路径（M0 之后要改动哪些位置）

| 未来动作 | 需要修改 | 不需要修改 |
|---|---|---|
| 开放客户自助注册 | `/auth/register` 从 501 换为真实现 + 加邀请码字段 | users / identities / sessions 表结构 |
| 接入 GitHub OAuth | 新增 `providers/github.ts` 回调路由 + 往 identities 写行 | users 表、session 机制 |
| 邮箱验证 / 密码重置 | `/auth/verify-email` 和 `/auth/password-reset/*` 从 501 换为真实现 + 接 SMTP | users / sessions 表；只需 `email_verified` 置位 |
| 加组织/团队概念 | 新增 `organizations` 表 + `memberships` 表 + 在 session 里加 current_org_id | users / identities / sessions 不动 |
| 多实例部署 | 限流存储从内存换 Redis | API 契约、表结构不动 |
| 前后端分域 | Cookie 改 `SameSite=None` + 加 CSRF token + CORS 白名单 | 会话机制核心不动 |

---

## 十二、未决项（留到 plan.md 或实现时决定）

- 是否引入 `pnpm workspace` 还是扁平单仓。本设计按 monorepo（`apps/`, `packages/`）布；若倾向扁平化，调整后 Identity 位置为 `src/modules/identity/` 不变。
- `express-rate-limit` 自带 store 是否够用，还是需要自写 `stores/ip.ts` / `stores/email.ts` 双键逻辑。
- `node-cron` 的部署形态：M0 直接与 api 同进程；将来多实例时是否需要选主。
- CLI 工具是否用独立 `apps/cli` 还是挂在 `apps/api` 的 npm script。本设计默认后者。

---

*本文档在 2026-04-23 的 brainstorming 会话中与用户逐段确认生成。下一步：用户审查本 spec → writing-plans 产出 plan.md → 实现。*
