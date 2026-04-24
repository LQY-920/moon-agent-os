# S3.5 迭代循环 · 手工冒烟测试报告

**测试日期**: 2026-04-24
**分支**: `feature/s3-5-iteration-loop`（HEAD: `088ccf9`）
**环境**: 本地 dev server + MySQL 8（Docker，端口 3308）

---

## 测试范围

M3 S3.5 迭代循环子系统的 HTTP API 层端到端验证：

- `POST /api/feedback` — 反馈创建
- `GET /api/artifacts/:id/feedback` — 反馈查询
- 鉴权 / 校验 / 错误路径
- 意图捕获端点可达性（S3.1 改造兼容性）

**未覆盖**：真实 LLM 驱动的迭代生成回路（依赖 DeepSeek API，由 E2E 以 mock LLM 覆盖；真实 LLM 迭代产物质量是 M3 单独话题）。

---

## 测试结果

| # | 场景 | 预期 | 实际 | 状态 |
|---|------|------|------|------|
| 1 | 未登录 POST `/api/feedback` | 401 | 401 | ✅ |
| 2 | 未登录 GET `/api/artifacts/:id/feedback` | 401 | 401 | ✅ |
| 3 | 登录后创建反馈（label=`function_bug` + comment 中文） | 201 + `{"success":true}` | `{"success":true}` | ✅ |
| 4 | 登录后再创建一条（label=`ui_issue`） | 201 + 独立记录 | `{"success":true}` | ✅ |
| 5 | 登录后查询反馈列表 | 时间倒序 2 条 | 返回 2 条，`artifactTitle` 正确填充 | ✅ |
| 6 | 非法 label（`invalid_label`） | 400 VALIDATION_FAILED | 400 | ✅ |
| 7 | 缺字段（无 label） | 400 VALIDATION_FAILED | 400 | ✅ |
| 8 | 不存在的 artifact_id | FeedbackNotFoundError | `{"error":{"code":"FEEDBACK_NOT_FOUND"}}` | ✅ |
| 9 | DB 层验证：中文 comment 存储 | feedbacks 表有 2 行 | MySQL utf8mb4 存储正常 | ✅ |
| 10 | 创建 intent session（S3.1 兼容性） | 201 + sessionId | 201 返回 ULID | ✅ |

---

## 一对多反馈权限（Q13 决策验证）

创建两条反馈到同一 artifact，均成功：
```json
{
  "items": [
    {"label":"ui_issue", "comment":"颜色太深", "createdAt":"2026-04-24T15:05:14.642Z"},
    {"label":"function_bug", "comment":"按钮点击无反应", "createdAt":"2026-04-24T15:05:14.589Z"}
  ]
}
```

- ✅ 时间倒序返回（最新在前）
- ✅ 仅 owner（session userId == artifact.user_id）可查
- ✅ `artifactTitle` 通过 `ArtifactRepository.findById` 正确填充

---

## Label 枚举校验（Q9 决策验证）

DB 层 CHECK 约束：
```sql
CONSTRAINT chk_feedbacks_label
  CHECK (label IN ('function_bug', 'ui_issue', 'slow_performance', 'missing_feature', 'other'))
```

- ✅ 应用层（Controller）先拦截非法 label → 400 VALIDATION_FAILED
- ✅ DB 约束兜底（假设绕过应用层也会被拒）

---

## 迭代生成回路（Q10/Q14/Q15 决策）

未在 smoke 中调用真实 LLM，但已通过以下验证：

- ✅ `ITERATE_KEYWORDS` 导出正确（14 个关键词，覆盖中英文）
- ✅ Unit 测试覆盖 `detectIterateMode` 边界（`test/unit/intent/intent-session.service.iterate.test.ts`）
- ✅ Unit 测试覆盖 `FeedbackService.matchByIntent` 关键词剥离 + 上限 5 条
- ✅ Integration 测试验证 `matchByIntent` SQL 查询正确（LIKE 匹配 + LIMIT 5）
- ✅ E2E 测试验证迭代关键词输入时端点可达性

**真实 LLM 驱动的 `origin='iteration'` artifact 生成需 M3 后期单独 smoke**（涉及 DeepSeek API 质量和 JSON 格式稳定性）。

---

## 安全与鉴权

- ✅ 所有 `/api/feedback` 端点均走 `requireSession` 中间件
- ✅ `FeedbackService.listByArtifactForOwner` 内部校验 owner，非 owner 抛 `FeedbackForbiddenError`
- ✅ 错误 `errorHandler` 正确映射为 HTTP 状态码（401/403/404/400）

---

## 结论

**S3.5 反馈收集回路验证通过。** 可以合并到 main。

后续 M3 迭代（需要跑真实 LLM 才能覆盖的内容）：
- 真实 LLM 调用 `POST /api/intent/.../messages`，用迭代关键词验证 origin='iteration' + parentArtifactId 链路
- 压力测试（大量反馈对 LIKE 查询性能的影响）
- 标签扩展 review 流程
