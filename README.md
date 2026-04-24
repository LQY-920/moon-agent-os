# moon-agent-os

> 🛠 **Build in Public** · 单人 + AI 杠杆从零搭一个"日抛型软件"平台的完整公开过程。
>
> - **定位**:软件形态按需生成、用过即弃;使用中产生的知识与记忆持久留存并持续进化("软件日抛、记忆进化")
> - **阶段**:Pre-MVP。M0/M1 已完成,下一里程碑 M2 是"意图→产物→运行→写回记忆"的第一条完整流水线
> - **开发方式**:1 人 + Claude Code + superpowers 方法论,每个子系统独立走 brainstorm → design → plan → 实现循环
> - **节奏**:每周五在 [moon-share](https://github.com/LQY-920/moon-share) 复盘一次架构/决策。代码、spec、决策表、访谈记录全公开可查
> - **欢迎**:提 issue / 讨论 spec / 访谈我(聊 30 分钟换"早期试用权")—— 技术型超级个体、独立开发者尤其欢迎

完整愿景与 28 个子系统拆解:[`docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`](docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md)

---

## 项目介绍

AI 智能体操作系统实践项目。日抛型软件 + 按日进化。

详细愿景见 `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`。

## 当前状态

- M0 地基:S1.1 账户与身份 ✅(仅一个账号,走 CLI 创建)
- M1 记忆骨架:S2.1 记忆存储 + S2.4 回忆 API ✅(对话文本存取,无内容搜索)
- M2 平台契约:S3.2 产物模型 ✅(平台契约中心,无 HTTP,供未来 M2 子系统 import)

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

## 记忆 API(M1)

所有端点都需要先登录拿 Cookie。

- `POST /api/memory/conversations` 创建会话
- `GET /api/memory/conversations` 列出会话
- `POST /api/memory/conversations/:id/messages` 追加消息
- `GET /api/memory/conversations/:id/messages` 读取消息
- `DELETE /api/memory/conversations/:id` 删除会话(级联消息)

详见 `docs/superpowers/specs/2026-04-23-s2-memory-core-design.md` 和 `docs/qa/s2-memory-manual-checklist.md`。

## 测试

```bash
pnpm test          # 全量(需要 Docker Desktop 跑起来)
pnpm test:unit     # 仅单元
pnpm test:integration
pnpm test:e2e
```

## 技术栈

Node.js 20 · TypeScript · Express 5 · MySQL 8 · Kysely · argon2 · Vitest · testcontainers
