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
