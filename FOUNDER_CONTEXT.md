# Founder Context

> 本文件由 `ognjengt/founder-skills` 技能包（strategic-planning / go-to-market-plan / linkedin-writer / x-writer / brand-copywriter 等）自动读取，用作所有创业类技能的共享业务上下文。
>
> 填写规则：
> - 能确定的字段填**事实**，不要写宣传口号
> - 尚未决定的字段写 `[待决策: <需要做什么来决策>]`，让 AI 明确知道这是盲区，避免幻觉
> - 决策后回来更新这份文件，技能输出质量随上下文质量直接放大

---

## About Your Business

- **Company name**: moon-agent-os（项目代号；正式公司主体 [待决策: 申请 OPC/一人公司时确定法人名称]）
- **Industry**: AI 应用平台 / Agent OS / 生成式软件基础设施
- **Target audience**:
  - **一层定位（平台用户）**: 有具体意图但不愿/不会自己搭工具的个人与小团队 —— 想解决某个当下问题、用完即弃、不想管"后续维护"的人群
  - **二层定位（创作者生态）**: 想把自己的工作流/能力打包成可被他人 fork 使用的独立开发者、咨询师、超级个体
  - **具体画像**: [待决策: 需要做一轮 customer-discovery 把一层定位锁定到 1-2 个具体细分，当前是通用假设]
- **Value proposition**:
  - **一句话**: 软件日抛、记忆进化 —— 你用过的每一个软件都在让"下一个软件"更懂你
  - **核心差异点**: 不是"生成一次性 app"（Lovable/Bolt 已在做），也不是"固定软件 + 对话"（传统 SaaS + AI），而是**用户级统一记忆中枢 + 按日进化的生成循环**，同一意图第二次被表达时产物明显优于第一次
  - **理论来源**: 参考钉钉创始人陈航 2026-04 的"日抛型软件"论断（详见 `docs/refs/2026-04-22-ri-pao-article.md`），moon-agent-os 是该理念的平台化实现

## Brand Voice

- **Tone**: 直接、工程化、不讲虚话；偶尔带产品哲学视角
- **Personality traits**: 务实、系统化、独立、长期主义
- **Key messages**:
  - 软件形态是临时的，用户的意图与记忆才是资产
  - 平台做编排、记忆、治理；模型/MCP/Claude Code 是底座
  - 超级个体不靠团队规模取胜，靠 AI 杠杆 + 系统化工作流
- **Words to use**: 日抛、按日进化、记忆中枢、产物、编排、意图、形态、超级个体
- **Words to avoid**: "颠覆"、"革命"、"赋能"、"生态闭环"、"一站式"、"All-in-One" —— 套话与假大空词汇

## Business Goals

- **Short-term (3-6 months, 2026-Q2~Q3)**:
  1. 完成 M0（S1.1 账户/身份，**已完成 2026-04-23**）→ M1（S2 记忆骨架：存储 + 召回 API，当前正在 plan 阶段）
  2. 跑通 M2 MVP：第一条完整流水线（意图 → 网页形态产物 → 运行 → 写回记忆），验证"日抛 + 进化"的最小闭环
  3. 申请 OPC / 注册法人主体，为后续商业化做合规准备
  4. 基于 `moon-share` 仓库建立 IP 初始阵地（公众号、小红书、视频号、X/LinkedIn），通过 `moon-agent-os` 的真实开发过程反哺内容
- **Long-term (1-3 years, 2027-2028)**:
  1. 形态层铺开（Skill/MCP 优先 → Agent/Workflow → App/小程序），覆盖 7 种产物形态
  2. 分发层（L5 Marketplace）上线，形成"创作者打包能力 → 他人 fork → 记忆迁移"的网络效应
  3. 打造"超级个体操作系统"的品类心智：个人不再买软件，而是拥有一套持续进化的智能中枢
- **Key metrics**:
  - **短期**: MVP 完成度、MVP 用户数（种子用户 10~50）、同一意图"第二次产物质量"的可感知提升比例
  - **中期**: 月活创作者数、产物 fork 数、记忆条目增长曲线
  - **IP 侧**: 公众号/视频号/小红书粉丝、每周沉淀文章数、技术内容的跨平台转发率

## Products/Services

- **Main offerings**: moon-agent-os 平台本体 —— 一个"日抛型软件生成与运行"的基础设施，用户通过它按需生成用完即弃的产物（网页/应用/MCP/Skill/工作流/Agent），所有使用痕迹沉淀到个人级记忆中枢
- **平台架构（四层洋葱，共 28 个子系统，详见 `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`）**:
  - L1 治理底座 · L2 记忆中枢 · L3 生成与运行引擎 · L4 形态层 · L5 分发层
- **Pricing model**: [待决策: 当前开发期无商业化。候选模型（等 MVP 跑通后用 `/pricing-strategist` 细化）：
  - 免费个人基础额度 + 用量型付费（token/API/存储）
  - 创作者分成（L5 分发层上线后）
  - 企业版/私有部署（远期，对应"企业智能中枢"场景）]
- **Key features/benefits**:
  - **用户侧**: 不再"学一个软件再用"，说出意图即得可运行产物，用完就丢但记忆留存
  - **创作者侧**: 把个人工作流打包成 Artifact，可被他人 fork 并保留自己的记忆边界
  - **差异化**: 记忆中枢是用户级而非产物级，跨产物共享，这是"按日进化"成立的前提

## Competitors

- **直接竞品（生成式应用/软件）**: Lovable, Bolt.new, v0 (Vercel), Replit Agent, Cursor Composer
- **相邻竞品（Agent 平台 / Skill 生态）**: Claude Code + Skills（本项目也是其上层用户）, OpenAI GPTs Store, Coze, Dify, 扣子
- **底座依赖（非竞争，是上游）**: Anthropic Claude, OpenAI, MCP 生态
- **Your advantages**:
  - 竞品做的是"生成一次性产物"，moon-agent-os 做的是"产物日抛 + 记忆进化"，这是**定位层的差异化**，不是功能差
  - 编排层策略：不重复造模型/运行时，在现有生态之上做记忆与治理的统一中枢
  - 单人开发 + AI 杠杆的极致实践本身就是产品故事的一部分（dogfooding）
- **Your risks**:
  - [待决策: 超级个体单人开发能否扛住平台级产品的工程复杂度 —— 需通过 M2 MVP 验证]
  - [待决策: "按日进化"的可感知性如果用户感受不到，差异化就塌了 —— M3 是最大风险点]

## Additional Context

- **Team size**: 1（单人开发；后续可能通过 AI 智能体扩展执行带宽而非招人）
- **Funding stage**: Pre-revenue / self-funded / 尚未寻求外部融资；未来若融资方向为独立开发者友好的天使/种子
- **Business structure**: [待决策: 准备申请 OPC（一人公司）作为法人主体，具体类型与注册地尚未最终确定]
- **Tech stack (platform)**:
  - 后端: Node.js + TypeScript + Express 5 + Kysely + MySQL 8
  - 密码/会话: argon2id + opaque session token
  - 基础模型/编排: Claude + MCP 生态（底层依赖，不自造）
  - 开发工作流: Claude Code + superpowers + moon-skills 自研技能
- **Development approach**: 采用 superpowers 方法论（brainstorming → writing-plans → executing-plans），所有子系统独立走完整设计循环；`moon-skills` 仓库是自研技能沉淀，`moon-share` 是 IP/内容沉淀
- **Current progress (截至 2026-04-24)**:
  - ✅ M0: S1.1 账户与身份全链路完成（注册/登录/会话/改密/测试）
  - ✅ M1: S2.1 记忆存储 + S2.4 召回 API 完成（对话文本存取，跨用户隔离，全量测试通过；内容搜索按设计砍到 M3 的 S2.3）
  - ⏳ M2 MVP 未启动: 意图 → 产物模型 → 网页形态运行时（下一个里程碑）
- **Distribution hypothesis（待验证）**: 前期靠内容 IP（`moon-share`）讲"单人 + AI 杠杆建平台"的真实过程，吸引同类超级个体作为种子用户与潜在创作者
- **Reference material**: 钉钉陈航 "日抛型软件" 论断（`docs/refs/2026-04-22-ri-pao-article.md`）—— 平台的理论锚点

---

**更新记录**:
- 2026-04-24: 初次创建，基于 vision spec + 当前开发进度填充
- 2026-04-24: M1 状态修正为 ✅ 已完成（存储 + 召回 API 全绿，内容搜索按设计延后到 M3）
