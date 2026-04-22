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
