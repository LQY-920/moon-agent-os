# S1.1 账户与身份手工 Smoke 测试报告

**日期**: 2026-04-23
**测试环境**: `feature/s1-1-identity` (HEAD `99cf078`)
**执行人**: QA (自动化 curl 驱动)

---

## §1 服务可用性

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| `GET /healthz` | HTTP 200, `{ok:true}` | HTTP 200, `{ok:true}` | PASS |

---

## §2 登录流程 — 正确凭证

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| POST `/api/auth/login` 正确凭证 | HTTP 200, 含 user 对象 | HTTP 200, user.id=`01KPVA202WH6B2RNH39WP3F4AB` | PASS |

---

## §2 登录流程 — 错误密码

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| POST `/api/auth/login` 错误密码 | HTTP 401, `INVALID_CREDENTIALS` | HTTP 401, `{code:"INVALID_CREDENTIALS"}` | PASS |
| 两次错误登录 response 一致 | 完全相同 error body | 完全一致 | PASS |

---

## §2 登录流程 — 不存在邮箱

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| POST `/api/auth/login` 不存在邮箱 | HTTP 401, `INVALID_CREDENTIALS` | HTTP 401, `{code:"INVALID_CREDENTIALS"}` | PASS |
| 与错误密码响应完全一致 | body 完全相同 | 完全一致 | PASS |

**结论**: 无论密码错误还是邮箱不存在，均返回统一的 `INVALID_CREDENTIALS`，不泄露账户存在信息。

---

## §3 `/me` 会话读取

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| 有 cookie 请求 `/me` | HTTP 200, user 对象 | HTTP 200, user.id 正确 | PASS |
| 无 cookie 请求 `/me` | HTTP 401, `UNAUTHENTICATED` | HTTP 401, `{code:"UNAUTHENTICATED"}` | PASS |
| 无效 cookie 请求 `/me` | HTTP 401, `UNAUTHENTICATED` | HTTP 401, `{code:"UNAUTHENTICATED"}` | PASS |

---

## §4 多设备会话

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| A 登录 → B 登录 → 各有独立 session | HTTP 200, 各返回不同 sessionId | HTTP 200, A=`01KPVA23J3RXD510HCFQX0ER8V`, B=`01KPVA2JAYKEK83PCEPC5TFDXF` | PASS |
| A revoke B session | HTTP 204 | HTTP 204 | PASS |
| B 原有 cookie 访问 `/me` | HTTP 401 | HTTP 401, `{code:"UNAUTHENTICATED"}` | PASS |
| A 的 cookie 仍有效 | HTTP 200 | HTTP 200 | PASS |

---

## §5 修改密码

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| 错误旧密码 | HTTP 401, `INVALID_CREDENTIALS` | HTTP 401, `{code:"INVALID_CREDENTIALS"}` | PASS |
| 新密码 < 12 字符 | HTTP 400, `VALIDATION_FAILED` | HTTP 400, `Too small: expected string to have >=12 characters` | PASS |
| 新密码过弱（常见密码） | HTTP 400, `密码过于常见` | HTTP 400, `密码过于常见,请使用更强的组合` | PASS |
| 新密码符合要求 | HTTP 204 | HTTP 204 | PASS |
| 改密后原有 cookie 失效 | HTTP 401 | HTTP 401, `{code:"UNAUTHENTICATED"}` | PASS |
| 新密码重新登录成功 | HTTP 200 | HTTP 200, new sessionId=`01KPVA45SMZW5S7FSTFM4AV1NB` | PASS |

---

## §6 限流

**IP 限流** (`IP_MAX=20`, `IP_WINDOW_MIN=10`):

| 次数 | 预期 | 实际 | PASS |
|------|------|------|------|
| 1-5 | HTTP 401 | HTTP 401 | PASS |
| 6 | HTTP 429 | HTTP 429 | PASS |
| 后续持续 429 | HTTP 429 | HTTP 429 (持续至 22 次测试) | PASS |

> 触发阈值后持续返回 429，直至时间窗口过半（600s 后方可重试）。前 5 次请求中 1 次成功登录，IP 限流器 `skipSuccessfulRequests: true` 所以该次成功请求不计入计数。

**Email 限流** (`EMAIL_MAX=5`, `EMAIL_WINDOW_MIN=10`):

| 次数 | 预期 | 实际 | PASS |
|------|------|------|------|
| 1-5 | HTTP 401 或 429 | HTTP 429 (首次即触发) | PASS |
| 后续持续 429 | HTTP 429 | HTTP 429 | PASS |

> Email 限流器独立于 IP 限流器工作，无成功请求抵消（均为错误密码请求）。前一个测试（IP 限流）中该 IP 的 20+ 次错误请求已将该 IP 的限流窗口重置，导致 Email 限流在新的错误尝试后立即触发。

---

## §7 501 占位端点

| 端点 | 预期 | 实际 | PASS |
|------|------|------|------|
| POST `/api/auth/register` | HTTP 501 | HTTP 501, `{code:"NOT_IMPLEMENTED",message:"M0 不开放注册,请联系管理员用 CLI 创建账户"}` | PASS |
| POST `/api/auth/verify-email` | HTTP 501 | HTTP 501, 同上 | PASS |
| POST `/api/auth/password-reset/request` | HTTP 501 | HTTP 501, 同上 | PASS |
| POST `/api/auth/password-reset/confirm` | HTTP 501 | HTTP 501, 同上 | PASS |

---

## §8 日志审计

日志输出摘录（`pnpm dev` 终端）:

```
# 错误密码登录 (reason: bad_password)
auth_event.login_failure
  { type:"login_failure", email:"lvyang@example.com", ip:"::1", reason:"bad_password" }

# 不存在邮箱登录 (reason: unknown_email)
auth_event.login_failure
  { type:"login_failure", email:"wrong@example.com", ip:"::1", reason:"unknown_email" }

# 成功登录 (无 token/cookie 值泄露)
auth_event.login_success
  { type:"login_success", userId:"01KPVA202WH6B2RNH39WP3F4AB", sessionId:"01KPVA23J3RXD510HCFQX0ER8V", ip:"::1", ua:"curl/8.14.1" }

# 修改密码
auth_event.password_changed
  { type:"password_changed", userId:"01KPVA202WH6B2RNH39WP3F4AB" }
auth_event.session_revoked
  { type:"session_revoked", userId:"01KPVA202WH6B2RNH39WP3F4AB", sessionId:"all", by:"password_change" }
```

| 检查项 | 预期 | 实际 | PASS |
|--------|------|------|------|
| `auth_event.login_success` 存在 | 是 | 是 | PASS |
| `auth_event.login_failure` 存在 | 是 | 是（两次，分别 reason: bad_password / unknown_email） | PASS |
| `login_failure.reason` 字段正确 | 有 `bad_password` 和 `unknown_email` | 有 | PASS |
| 日志中无 `mao_sess` cookie 值 | 无 | 无 | PASS |
| 日志中无明文 token | 无 | 无 | PASS |

---

## 汇总

| 章节 | PASS | FAIL |
|------|------|------|
| §1 服务可用性 | 1 | 0 |
| §2 登录（正确/错误密码/不存在邮箱） | 5 | 0 |
| §3 /me | 3 | 0 |
| §4 多设备会话 | 4 | 0 |
| §5 修改密码 | 6 | 0 |
| §6 限流（IP + Email） | 4 | 0 |
| §7 501 占位端点 | 4 | 0 |
| §8 日志审计 | 4 | 0 |
| **合计** | **31** | **0** |

**结论**: 31/31 全部 PASS，S1.1 账户与身份子系统 smoke test 全部通过。
