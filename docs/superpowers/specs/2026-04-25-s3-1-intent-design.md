# S3.1 · 意图捕获(Intent Capture)设计

> **范围**:moon-agent-os 平台 L3 层 Forge & Runtime 的 S3.1 意图捕获子系统。Vision 文档里程碑 M2 的一部分。
>
> **定位**:用户的对话式入口。把模糊想法通过多轮澄清变成结构化意图,触达 Forge 生成产物。

**生成日期**: 2026-04-25
**依赖**: S1.1 身份 / S2.1 记忆 / S3.2 产物模型(全部已完成);S3.3 Forge 流水线(并行,M3 实现)
**参考**: `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`

---

## 一、目标与边界

### S3.1 要交付什么

一个对话式入口,用户通过自然语言描述需求,S3.1 通过多轮 LLM 追问逐步澄清意图,最终触发生成。

**必须具备**:
- 双 HTTP 端点:创建会话 + 发送消息
- 多轮 LLM 追问:判断意图是否清晰,清晰则触发
- 复用 S2.1 MemoryService 存储对话历史
- LLM 接口抽象:原生 fetch + 接口隔离
- 非 streaming(未来 S4.1 接入时升级)
- 同步触发生成(S3.3 stub)

**明确不做**(留给未来):
- ❌ Streaming 输出(S4.1 接入时升级)
- ❌ 形态推荐(M2 直接写死 `form='web'`)
- ❌ 跨会话长期记忆召回(S2.3 M3 再做,当前只读同会话历史)
- ❌ 异步生成队列(S3.5 M3 迭代循环再做)
- ❌ 形态多样(M2 只有 web)

---

## 二、关键决策

| # | 维度 | 决策 | 理由 |
|---|---|---|---|
| 1 | 触发方式 | 文本 + 多轮澄清 | 对话式入口,体验优于纯表单 |
| 2 | Intent 字段 | M2 极简 `{ description }`,不单独存 | intent 作为参数传给 S3.3,不占 artifact 行 |
| 3 | LLM 可用性 | 有,自选 API | 按日进化依赖 LLM |
| 4 | 对话进记忆 | 全存 S2.1,不区分意图澄清和普通对话 | 创作过程即记忆,同会话上下文;M3 加 source 字段区分 |
| 5 | 触发时机 | LLM 自动判断意图清晰 | 用户不说特定命令,体验最优 |
| 6 | API 形态 | HTTP 端点 | 用户入口必须有 HTTP,S2 已验证这套模式 |
| 7 | 会话管理 | 复用 S2.1 MemoryService | 不重复造轮子;system role 临时标记 AI 回复 |
| 8 | 端点设计 | 双端点:`POST /sessions` + `POST /sessions/:id/messages` | 单端点用 optional conversationId 语义别扭 |
| 9 | 响应格式 | 结构化 JSON:`{ message, status, intent }` | 前端需知道当前是追问还是已触发 |
| 10 | LLM 上下文 | 传完整同会话对话历史 | M2 条件下的最优解;M3 加跨会话召回 |
| 11 | System prompt | 配置文件 `src/config/intent-prompt.ts` | 便于调优,不比环境变量或代码更重 |
| 12 | LLM 框架 | 原生 fetch + 接口抽象隔离 | 框架引入复杂度不值,S3.1/S3.3 共用接口;未来换框架只改实现 |
| 13 | Streaming | M2 非 streaming,未来升级 | S4.1 前端未就绪,streaming 没人消费;非 streaming → streaming 是增量改动 |
| 14 | 触发同步性 | 同步,S3.3 完成再返回 | 无 SSE/WebSocket 推送基础设施,同步最简单 |

---

## 三、架构

### 数据流

```
用户 ←HTTP→ IntentController
                  ↓
           IntentSessionService
           ↓              ↓
    MemoryService     LLM Client (Native)
    (S2.1)            ↓
    存对话历史    ForgeService (stub, M3 实现)
```

### 目录结构

```
src/
├── config/
│   └── intent-prompt.ts              # System prompt 配置
├── modules/
│   ├── intent/
│   │   ├── routes.ts
│   │   ├── schema.ts
│   │   ├── controllers/
│   │   │   └── intent.controller.ts
│   │   ├── services/
│   │   │   └── intent-session.service.ts
│   │   └── domain/
│   │       └── errors.ts
│   └── llm/
│       ├── client.ts                 # LlmClient 接口
│       └── native.ts                 # NativeLlmClient 实现
└── modules/forge/
    └── forge.service.ts             # stub,M3 实现
```

---

## 四、HTTP 契约

### 端点 1:创建会话

**POST** `/api/intent/sessions`

Body:`{}` 无参数。会话自动关联当前登录用户。

**201 Created**:
```json
{
  "sessionId": "01K4...",
  "userId": "01H9...",
  "createdAt": "2026-04-25T10:15:30.123Z"
}
```

**401**:未登录

### 端点 2:发送消息

**POST** `/api/intent/sessions/:id/messages`

Path:`id` = sessionId(同时是 S2.1 conversationId,复用同一 ID)

Body:
```json
{ "message": "我想做一个记账 app" }
```

**200 OK**(追问中):
```json
{
  "message": "请问记账的频率是每天还是每周?",
  "status": "clarifying",
  "intent": null
}
```

**200 OK**(已触发):
```json
{
  "message": "好的,记账 app 正在生成中...",
  "status": "triggered",
  "intent": {
    "description": "一个记账 app,支持每日记账和报表查看",
    "form": "web"
  }
}
```

**错误**:
- `401 UNAUTHENTICATED`:未登录
- `403 SESSION_FORBIDDEN`:会话不属于当前用户
- `404 SESSION_NOT_FOUND`:会话不存在
- `400 VALIDATION_FAILED`:message 为空

---

## 五、LLM 接口抽象

### 接口定义

```typescript
// src/modules/llm/client.ts

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface LlmResponse {
  content: string;
}

export interface LlmClient {
  complete(messages: LlmMessage[]): Promise<LlmResponse>;
}
```

**设计原则**:
- 接口是唯一耦合点,S3.1 / S3.3 都依赖 `LlmClient`
- 实现可替换,不影响调用方

### System Prompt

```typescript
// src/config/intent-prompt.ts

export const INTENT_SYSTEM_PROMPT = `你是一个意图捕获助手。

规则:
1. 用户每发一条消息,你判断当前意图是否足够清晰。
2. "清晰"的判断标准:用户描述了要做什么(应用名称或核心功能)。
3. 如果意图不清晰,提一个追问,不超过20个字。
4. 如果意图清晰,返回 EXECUTE 标记,格式:
   __EXECUTE__
   { "description": "用户的完整需求描述" }
   不要加任何其他内容。

注意:不要生成应用代码,只负责理解和追问。`;
```

### Native 实现

```typescript
// src/modules/llm/native.ts

export class NativeLlmClient implements LlmClient {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async complete(messages: LlmMessage[]): Promise<LlmResponse> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
    const data = await res.json() as { content: Array<{ text: string }> };
    return { content: data.content[0]?.text ?? '' };
  }
}
```

**配置**(在 `core/config.ts` 加):
- `LLM_API_KEY`
- `LLM_MODEL`

---

## 六、Service 逻辑

### IntentSessionService

```typescript
export class IntentSessionService {
  constructor(
    private readonly memory: MemoryService,
    private readonly llm: LlmClient,
    private readonly forge: ForgeService,
    private readonly systemPrompt: string,
  ) {}

  async createSession(userId: string): Promise<Conversation> {
    return this.memory.createConversation(userId, { title: `intent:${Date.now()}` });
  }

  async sendMessage(
    userId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<{ message: string; status: 'clarifying' | 'triggered'; intent: { description: string; form: 'web' } | null }> {

    // 1. 归属校验
    await this.memory.getConversation(userId, sessionId);

    // 2. 写用户消息入记忆
    await this.memory.addMessage(userId, sessionId, { role: 'user', content: userMessage });

    // 3. 读对话历史,构造 LLM 上下文
    const history = await this.memory.listMessages(userId, sessionId, { limit: 100 });
    const llmMessages = buildLlmMessages(history.items, this.systemPrompt);

    // 4. LLM 调用
    const response = await this.llm.complete(llmMessages);

    // 5. 解析输出
    const { isExecutable, responseText, intentDescription } = parseLlmOutput(response.content);

    // 6. 写 AI 回复入记忆(system role = AI 回复)
    await this.memory.addMessage(userId, sessionId, { role: 'system', content: responseText });

    // 7. 判断
    if (isExecutable) {
      await this.forge.triggerFromIntent(userId, sessionId, {
        description: intentDescription ?? userMessage,
        form: 'web',
      });
      return { message: responseText, status: 'triggered', intent: { description: intentDescription ?? userMessage, form: 'web' } };
    }
    return { message: responseText, status: 'clarifying', intent: null };
  }
}
```

### 辅助函数

```typescript
function buildLlmMessages(history: Message[], systemPrompt: string): LlmMessage[] {
  const msgs: LlmMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'system') msgs.push({ role: 'assistant', content: m.content });
  }
  return msgs;
}

function parseLlmOutput(content: string): {
  isExecutable: boolean; responseText: string; intentDescription: string | null;
} {
  if (content.includes('__EXECUTE__')) {
    const descMatch = content.match(/"description":\s*"([^"]+)"/);
    return {
      isExecutable: true,
      responseText: content.replace(/__EXECUTE__[\s\S]*$/, '').trim(),
      intentDescription: descMatch ? descMatch[1] : null,
    };
  }
  return { isExecutable: false, responseText: content.trim(), intentDescription: null };
}
```

### ForgeService Stub

```typescript
// src/modules/forge/forge.service.ts (M2 stub)

export class ForgeService {
  async triggerFromIntent(
    userId: string,
    sessionId: string,
    input: { description: string; form: 'web' },
  ): Promise<void> {
    // M3 实现:从 description 提取结构 → 调 LLM 生成 → 存入 artifact 表
    console.log(`[forge stub] user=${userId} session=${sessionId} desc=${input.description}`);
  }
}
```

---

## 七、错误处理

复用既有:
- `ConversationNotFoundError`(404) / `ConversationForbiddenError`(403):MemoryService 抛出,直接透传
- S3.1 新增:
  - `IntentMessageEmptyError`(400)

---

## 八、测试策略

### Unit
- `parseLlmOutput`:含/不含 `__EXECUTE__` 标记;description 提取;空 content
- `buildLlmMessages`:空历史/单轮/多轮历史;system role 在首
- IntentSessionService:mock memory + mock llm;trigger / clarifying 分叉

### Integration
- S3.1 → MemoryService 真实调用(用 mock LLM 替换)
- LLM 返回含 `__EXECUTE__` → 验证 `forge.triggerFromIntent` 被调用
- LLM 返回追问 → 验证无 forge 调用,返回 `status: 'clarifying'`

### E2E
- 登录 → 创建会话 → 发送消息 → 验证对话进了 S2.1(memory 端点查)

### Smoke
- 手工清单,对齐 S2 模板

---

## 九、非功能性约束

| 维度 | 约束 |
|---|---|
| **性能** | LLM 调用是主要延迟(秒级);无缓存需求 |
| **安全** | 复用 `requireSession`;归属校验在 service 层 |
| **可观测** | LLM 调用打日志(耗时/token);prompt 文件路径入日志 |
| **错误处理** | LLM API 失败 → 500;session 校验透传 MemoryService 错误 |

---

## 十、与未来里程碑的接口

| 里程碑 | 变化 |
|---|---|
| M3 S2.3 | S3.1 读同会话历史 → 加跨会话记忆召回 |
| M3 S3.3 | `ForgeService.triggerFromIntent` 实现真正生成逻辑 |
| M3 S3.5 | 生成后反馈写回记忆,S3.1 读取进化后的上下文 |
| M4 S4.1 | S3.1 HTTP 升级 streaming;前端 SSE 消费流式输出 |
| M4 形态扩展 | `form='web'` → 动态,表单选择形态后传给 S3.3 |

---

*本设计基于 2026-04-25 brainstorming 对话生成。14 个决策见第二节。*
