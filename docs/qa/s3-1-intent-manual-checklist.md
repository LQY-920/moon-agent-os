# S3.1 · 手工 smoke 清单

前提:`.env` 有 `LLM_API_KEY` / `LLM_MODEL`;服务 `pnpm dev` 已启动。

## 1. 鉴权

- [ ] 无 cookie → `POST /api/intent/sessions` → 401
- [ ] 无 cookie → `POST /api/intent/sessions/:id/messages` → 401

## 2. 创建会话

- [ ] `POST /api/intent/sessions` → 201 + `sessionId`(26 字符)
- [ ] 返回 `userId` 和 `createdAt`

## 3. 发送消息(LLM 追问)

- [ ] 发送一个模糊需求 → 返回追问内容
- [ ] 对话进了 S2.1:GET `/api/memory/conversations/:id/messages` 有两条(用户+AI)

## 4. 发送消息(LLM 触发)

- [ ] 多轮对话后 LLM 触发 → `status: "triggered"` + `intent.description`
- [ ] 触发后 Forge stub 打印 log `[forge stub]`

## 5. 验证

- [ ] `/api/memory/conversations/:id/messages` 看到完整对话历史
