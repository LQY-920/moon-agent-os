# S4.1 · 网页运行器(Web Runtime)设计

> **范围**: moon-agent-os 平台 L4 层 Runtime 的 S4.1 网页运行器子系统。Vision 文档里程碑 M2 的一部分。
>
> **定位**: 把 S3.2 存储的 web artifact 变成用户可访问、可运行的独立页面，闭合 M2 流水线最后一步。

**生成日期**: 2026-04-25
**依赖**: S3.2 产物模型 / S3.3 生成流水线（全部已完成）
**并行**: M2 其他子系统
**参考**: `docs/superpowers/specs/2026-04-22-moon-agent-os-vision-decomposition.md`

---

## 一、目标与边界

### S4.1 要交付什么

把 S3.3 生成的 web artifact（entryHtml）渲染为独立的、可访问的 HTML 页面。

**核心流程**:
```
用户打开 /app/{artifactId}
        │
        ▼
  鉴权中间件（按 visibility 决定）
        │
        ▼
  artifactService.get(artifactId)
        │
        ▼
  SSR 模板拼装（顶栏 + iframe srcdoc）
        │
        ▼
  HTML 返回浏览器
```

**必须具备**:
- `GET /app/:artifactId` SSR 端点：按 visibility 鉴权，返回完整 HTML
- `PATCH /api/artifacts/:id` 端点：修改 visibility（owner only）
- 轻量顶栏：返回按钮 + artifact 标题 + 公开/私密开关
- iframe sandbox 隔离：entryHtml 通过 srcdoc 注入，JS/CSS 天然隔离
- 404/403 标准错误页面

**明确不做**（留给未来）:
- ❌ 公开画廊/发现页（M4 才有）
- ❌ 团队协作/分享给特定用户（M4+）
- ❌ 运行时双向通信（postMessage 等，M4+）
- ❌ 多 artifact 聚合运行（M4 S4.x）

---

## 二、关键决策

| # | 维度 | 决策 | 理由 |
|---|---|---|---|
| 1 | 运行形态 | 独立页面直接渲染 | 真正的「日抛」体验，无平台痕迹 |
| 2 | 访问控制 | 默认私密，公开手动开启 | 平衡安全与分享；M4 画廊再默认公开 |
| 3 | URL 机制 | `/app/{artifactId}` 同源路径 | artifactId 复用现有 ID；Cookie 复用；无跨域 |
| 4 | 运行时隔离 | sandbox iframe srcdoc | 天然 JS/CSS 隔离；安全性好；已知模式 |
| 5 | 外部资源 | 内联到 entryHtml | S4.1 MVP HTML 体量小（<50KB）；最简单；Blob URL 留 M3 |
| 6 | 错误处理 | 404 标准页面 | HTTP 语义清晰；用户熟悉；M2 不需要引导页 |
| 7 | 平台整合 | 轻量顶栏（返回按钮 + 标题） | 用户有回退路径；不占用太多空间；比完整 Shell 轻 |
| 8 | 认证策略 | 按 visibility 动态决定 | 公开 artifact 可被未登录用户访问；私密仅 owner 可访问 |
| 9 | visibility 存储 | 新增 `artifacts.visibility` 列 | 可索引；类型安全；一次 migration 长期受益 |
| 10 | 前端技术栈 | Express SSR | 零前端框架；与现有栈一致；首屏 0 延迟 |

---

## 三、架构

### 数据流

```
请求: GET /app/{artifactId}
        │
        ▼
┌───────────────────────────────┐
│   visibility 中间件           │
│   (先查 artifact.visibility)  │
│                               │
│   public → next()            │
│   private + 无登录 → 302 重定向登录页 │
│   private + 非 owner → 404   │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│   artifactService.get()       │
│   查 artifacts 表             │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│   SSR 模板渲染                │
│   顶栏 HTML + iframe srcdoc   │
└───────────────┬───────────────┘
                │
                ▼
         返回完整 HTML
```

### 目录结构

```
src/
├── modules/
│   └── runtime/
│       ├── routes/
│       │   └── web-runtime.routes.ts    # /app/:id 端点
│       └── controllers/
│           └── web-runtime.controller.ts # SSR 逻辑
├── views/
│   └── web-runtime/                     # SSR 模板
│       ├── app-layout.html.ts            # 页面骨架
│       └── error-layout.html.ts         # 错误页
├── services/
│   └── runtime.service.ts              # visibility 切换逻辑
├── migrations/
│   └── 20260425_004_add_artifact_visibility.ts
└── core/
    └── middleware/
        └── artifact-visibility.middleware.ts

src/modules/artifact/
├── services/artifact.service.ts         # updateVisibility() 扩展
├── repositories/artifact.repository.ts   # .visibility 字段读
└── registry/web.schema.ts              # metadata.visibility 移除（已在 DB）
```

### 依赖关系

```
web-runtime.controller 依赖:
  - ArtifactService.get(id)           (S3.2 已建)
  - ArtifactService.updateVisibility  (本次扩展)
  - Express Response (原生)

artifact-visibility.middleware 依赖:
  - ArtifactService.get(id)           (S3.2 已建)
  - SessionService.getUserId()        (S1.1 已建)

migration 依赖:
  - Kysely / MigrationsRunner         (已有)
```

---

## 四、核心代码

### Migration: 添加 visibility 列

```typescript
// migrations/20260425_004_add_artifact_visibility.ts

import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. 新增 visibility 列，默认 'private'
  await db.execute(sql`
    ALTER TABLE artifacts
      ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private'
  `);

  // 2. 约束：只允许 'private' | 'public'
  await db.execute(sql`
    ALTER TABLE artifacts
      ADD CONSTRAINT chk_artifacts_visibility
      CHECK (visibility IN ('private', 'public'))
  `);

  // 3. 索引：按 visibility 查询（如未来画廊页）
  await db.execute(sql`
    ALTER TABLE artifacts
      ADD KEY idx_artifacts_visibility (visibility)
  `);

  // 4. 索引：(user_id, visibility) 组合查询
  await db.execute(sql`
    ALTER TABLE artifacts
      ADD KEY idx_artifacts_user_visibility (user_id, visibility)
  `);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.execute(sql`
    ALTER TABLE artifacts
      DROP COLUMN visibility
  `);
}
```

### ArtifactService 扩展

```typescript
// src/modules/artifact/services/artifact.service.ts（增量改动）

import type { ArtifactVisibility } from '../domain/types';

export class ArtifactService {
  // ... 现有方法不变 ...

  async updateVisibility(
    userId: string,
    artifactId: string,
    visibility: ArtifactVisibility,
  ): Promise<Artifact> {
    const artifact = await this.artifacts.findById(artifactId);
    if (!artifact) throw new ArtifactNotFoundError(artifactId);
    if (artifact.userId !== userId) throw new ArtifactForbiddenError();

    await this.artifacts.updateVisibility(artifactId, visibility);
    return this.artifacts.findById(artifactId);
  }

  async getForRuntime(artifactId: string): Promise<Artifact> {
    const artifact = await this.artifacts.findById(artifactId);
    if (!artifact) throw new ArtifactNotFoundError(artifactId);
    return artifact;
  }
}

export type ArtifactVisibility = 'private' | 'public';
```

### ArtifactRepository 增量

```typescript
// src/modules/artifact/repositories/artifact.repository.ts（增量）

async updateVisibility(id: string, visibility: ArtifactVisibility): Promise<void> {
  await this.db
    .updateTable('artifacts')
    .set({ visibility })
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}
```

### Visibility 中间件

```typescript
// src/core/middleware/artifact-visibility.middleware.ts

import type { Request, Response, NextFunction } from 'express';
import type { ArtifactService } from '../../modules/artifact/services/artifact.service';
import type { SessionService } from '../../modules/identity/services/session.service';

export function createVisibilityMiddleware(
  artifactService: ArtifactService,
  sessionService: SessionService,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const artifactId = req.params.artifactId;
    if (!artifactId) return next();

    let artifact;
    try {
      artifact = await artifactService.getForRuntime(artifactId);
    } catch (e) {
      if (e instanceof ArtifactNotFoundError) {
        return res.status(404).render('error', {
          title: '404 - 页面不存在',
          message: '您访问的页面不存在或已被删除',
        });
      }
      throw e;
    }

    if (artifact.visibility === 'public') {
      // 公开 artifact：任何人都可访问，包括未登录用户
      req.context = { ...req.context, artifact };
      return next();
    }

    // 私密 artifact：必须登录且为 owner
    const userId = await sessionService.getUserId(req);
    if (!userId) {
      return res.redirect('/login');  // 未登录 → 重定向登录页
    }

    if (artifact.userId !== userId) {
      return res.status(404).render('error', {
        title: '404 - 页面不存在',
        message: '您访问的页面不存在或已被删除',
      });
    }

    req.context = { ...req.context, artifact };
    next();
  };
}
```

### WebRuntimeController（SSR）

```typescript
// src/modules/runtime/controllers/web-runtime.controller.ts

import type { Request, Response } from 'express';
import type { ArtifactService } from '../../artifact/services/artifact.service';
import type { Artifact } from '../../artifact/domain/types';

export class WebRuntimeController {
  constructor(private readonly artifactService: ArtifactService) {}

  async renderApp(req: Request, res: Response) {
    const artifact = req.context.artifact as Artifact;

    // 提取 entryHtml（S3.3 生成的 artifact payload）
    const payload = artifact.payload as { entryHtml: string };
    const entryHtml = payload.entryHtml;

    // 构建 SSR HTML（顶栏 + iframe srcdoc）
    const html = this.buildHtml(artifact.title, entryHtml, artifact.visibility);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  private buildHtml(title: string, entryHtml: string, visibility: string) {
    // 轻量顶栏
    const topbar = `
      <div id="moon-topbar">
        <a href="/" class="back-btn">← 返回平台</a>
        <span class="title">${this.escapeHtml(title)}</span>
        <span class="visibility-badge ${visibility}">${visibility === 'public' ? '🔓 公开' : '🔒 私密'}</span>
      </div>
    `;

    // iframe sandbox（只允许同源脚本）
    const iframe = `<iframe
      id="app-frame"
      sandbox="allow-scripts allow-same-origin"
      srcdoc="${this.escapeAttribute(entryHtml)}"
    ></iframe>`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; }
    #moon-topbar {
      display: flex; align-items: center; gap: 16px;
      padding: 12px 20px; background: #1a1a2e; color: #fff;
      position: sticky; top: 0; z-index: 100;
    }
    .back-btn { color: #fff; text-decoration: none; font-size: 14px; }
    .back-btn:hover { text-decoration: underline; }
    .title { flex: 1; font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .visibility-badge { font-size: 12px; padding: 4px 8px; border-radius: 4px; }
    .visibility-badge.public { background: #059669; }
    .visibility-badge.private { background: #6b7280; }
    #app-frame { width: 100vw; height: calc(100vh - 52px); border: none; }
  </style>
</head>
<body>
${topbar}
${iframe}
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttribute(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
```

### Routes 配置

```typescript
// src/modules/runtime/routes/web-runtime.routes.ts

import type { Router } from 'express';
import { WebRuntimeController } from '../controllers/web-runtime.controller';
import { createVisibilityMiddleware } from '../../core/middleware/artifact-visibility.middleware';

export function registerWebRuntimeRoutes(
  router: Router,
  artifactService: ArtifactService,
  sessionService: SessionService,
) {
  const controller = new WebRuntimeController(artifactService);
  const visibilityMiddleware = createVisibilityMiddleware(artifactService, sessionService);

  // SSR 页面：GET /app/:artifactId
  router.get('/app/:artifactId', visibilityMiddleware, (req, res) => {
    controller.renderApp(req, res);
  });

  // 切换 visibility：PATCH /api/artifacts/:artifactId
  router.patch('/api/artifacts/:artifactId', async (req, res, next) => {
    try {
      const userId = await sessionService.getUserId(req);
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });

      const { visibility } = req.body;
      if (!['private', 'public'].includes(visibility)) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED' } });
      }

      await artifactService.updateVisibility(userId, req.params.artifactId, visibility);
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  });
}
```

---

## 五、main.ts 装配变化

```typescript
// src/main.ts（增量改动）

// 1. 引入新模块
import { registerWebRuntimeRoutes } from './modules/runtime/routes/web-runtime.routes';
import { ArtifactService } from './modules/artifact/services/artifact.service';
import { SessionService } from './modules/identity/services/session.service';

// 2. 注册路由（在 expressApp 创建后）
registerWebRuntimeRoutes(
  expressApp,
  artifactService,  // 已在用的
  sessionService,   // 已在用的
);
```

**注意**: `ArtifactService` 和 `SessionService` 已在 S3.1/S1.1 装配好，不需要新增依赖。

---

## 六、错误处理

| 场景 | 行为 |
|---|---|
| artifact 不存在 | 404 HTML 错误页（中间件处理） |
| 私密 artifact + 未登录 | 302 重定向到 `/login` |
| 私密 artifact + 非 owner | 404 HTML 错误页 |
| visibility 字段为空 | 默认按 `private` 处理（migration 已设 DEFAULT） |
| entryHtml 为空 | 404 错误页（artifact.payload 格式错误视为不存在） |

**前端错误页**: 简单的纯 HTML，无任何 JS，无外部资源依赖。

---

## 七、测试策略

### Unit (`test/unit/runtime/`)
- `web-runtime.controller.test.ts`：
  - `buildHtml()` 生成正确的顶栏 HTML
  - `escapeHtml()` / `escapeAttribute()` 正确转义 XSS 攻击
  - srcdoc 内容被正确注入到 iframe
- `visibility.middleware.test.ts`：
  - public artifact → next() 被调用
  - private artifact + 无 session → 302 重定向
  - private artifact + 非 owner → 404
  - artifact 不存在 → 404

### Integration (`test/integration/runtime/`)
- `web-runtime.e2e.test.ts`：
  - 登录用户访问自己的 artifact → 200 + iframe srcdoc 存在
  - 未登录访问 public artifact → 200
  - 未登录访问 private artifact → 302 到 login
  - 修改 visibility → API 成功 + 页面行为变化

### 手动检查
- 浏览器打开 `/app/:artifactId`，确认：
  1. 顶栏显示正确
  2. iframe 内 entryHtml 正确渲染
  3. sandbox 隔离生效（`alert()` 在 iframe 内弹出，不污染主页面）

---

## 八、非功能性约束

| 维度 | 约束 |
|---|---|
| **性能** | SSR 无额外网络请求（前端零 JS）；artifact 查询走已有索引 |
| **安全** | srcdoc 天然隔离；XSS 风险靠 escape 兜底；sandbox 只开 allow-scripts allow-same-origin |
| **可观测** | visibility 切换打 info 日志 |
| **兼容性** | srcdoc 兼容性：所有现代浏览器支持（IE11 除外，M2 已不兼容） |

---

## 九、与未来里程碑的接口

| 里程碑 | 变化 |
|---|---|
| M3 S4.x | Blob URL 外链资源；运行时 postMessage 通信；多 artifact 聚合 |
| M4 画廊 | `idx_artifacts_visibility` 索引支撑「公开 artifact 列表」查询 |
| M4 团队协作 | visibility 扩展为 `shared_with` 多用户模式 |

---

## 十、实现顺序提示（给 writing-plans）

1. `20260425_004_add_artifact_visibility.ts` migration
2. `ArtifactRepository.updateVisibility()` + `ArtifactService.updateVisibility()`
3. `artifact-visibility.middleware.ts`（按 visibility 鉴权）
4. `web-runtime.controller.ts`（SSR 模板渲染）
5. `web-runtime.routes.ts`（注册路由）
6. `main.ts` 装配（注册路由）
7. Unit 测试（controller + middleware）
8. Integration 测试（完整流程）
9. Typecheck + 全量测试绿

---

*本设计基于 2026-04-25 brainstorming 对话生成。10 个决策见第二节。*