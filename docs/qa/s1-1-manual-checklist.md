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
