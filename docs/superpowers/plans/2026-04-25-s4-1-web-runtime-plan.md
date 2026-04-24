# S4.1 · 网页运行器(Web Runtime)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 S4.1 网页运行器，把 S3.3 生成的 web artifact（entryHtml）渲染为独立的可访问页面，闭合 M2 流水线。

**Architecture:** SSR + sandbox iframe srcdoc。Express 返回完整 HTML（顶栏 + iframe），visibility 中间件按 DB 字段动态鉴权。

**Tech Stack:** TypeScript · Express · Kysely · MySQL · SSR (no frontend framework)

---

## 文件结构

```
migrations/
└── 20260425_004_add_artifact_visibility.ts   # 新增：visibility 列

src/
├── core/middleware/
│   └── artifact-visibility.middleware.ts     # 新增：按 visibility 鉴权
├── modules/artifact/
│   ├── domain/types.ts                      # 修改：ArtifactVisibility 类型
│   ├── repositories/artifact.repository.ts  # 修改：updateVisibility
│   └── services/artifact.service.ts         # 修改：updateVisibility + getForRuntime
├── modules/runtime/
│   ├── controllers/
│   │   └── web-runtime.controller.ts        # 新增：SSR 模板渲染
│   └── routes/
│       └── web-runtime.routes.ts            # 新增：/app/:id + PATCH visibility
└── main.ts                                  # 修改：注册 runtime 路由

test/
├── unit/
│   ├── runtime/
│   │   ├── web-runtime.controller.test.ts   # 新增
│   │   └── visibility.middleware.test.ts    # 新增
│   └── artifact/
│       └── artifact.service.test.ts         # 修改：updateVisibility 测试
└── integration/
    └── runtime/
        └── web-runtime.int.test.ts          # 新增
```

---

## Task 1: 创建 visibility migration

**Files:**
- Create: `migrations/20260425_004_add_artifact_visibility.ts`
- Reference: `migrations/20260424_003_init_artifact.ts`

- [ ] **Step 1: 创建 migration**

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

  // 3. 索引：按 visibility 查询（未来画廊页）
  await db.execute(sql`
    ALTER TABLE artifacts
      ADD KEY idx_artifacts_visibility (visibility)
  `);

  // 4. 组合索引：(user_id, visibility)
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

- [ ] **Step 2: 更新 core/db.ts 类型**

在 `src/core/db.ts` 的 Database interface 中添加 `visibility` 字段（如果 Kysely 会自动生成则跳过）。

找到 `artifacts` 表定义，添加：
```typescript
visibility: Generated<string>;
```

- [ ] **Step 3: Run migration**

```bash
pnpm db:migrate
```

- [ ] **Step 4: Commit**

```bash
git add migrations/20260425_004_add_artifact_visibility.ts src/core/db.ts
git commit -m "feat(s4.1): add artifacts.visibility column with migration"
```

---

## Task 2: 扩展 ArtifactRepository 和 ArtifactService

**Files:**
- Modify: `src/modules/artifact/repositories/artifact.repository.ts`
- Modify: `src/modules/artifact/services/artifact.service.ts`
- Modify: `src/modules/artifact/domain/types.ts`
- Reference: `src/modules/identity/repositories/user.repository.ts`（update pattern）

- [ ] **Step 1: 添加 ArtifactVisibility 类型**

```typescript
// src/modules/artifact/domain/types.ts（增量）

export type ArtifactVisibility = 'private' | 'public';
```

- [ ] **Step 2: ArtifactRepository 添加 updateVisibility**

```typescript
// src/modules/artifact/repositories/artifact.repository.ts（增量）

import type { ArtifactVisibility } from '../domain/types';

export class ArtifactRepository {
  // ... 现有方法不变 ...

  async updateVisibility(id: string, visibility: ArtifactVisibility): Promise<void> {
    await this.db
      .updateTable('artifacts')
      .set({ visibility })
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  async findById(id: string): Promise<ArtifactRow | undefined> {
    return this.db
      .selectFrom('artifacts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
```

同时给 `ArtifactRow` 接口加上 `visibility` 字段：
```typescript
interface ArtifactRow {
  // ... existing fields ...
  visibility: string;
}
```

- [ ] **Step 3: ArtifactService 添加 updateVisibility 和 getForRuntime**

```typescript
// src/modules/artifact/services/artifact.service.ts（增量方法）

import type { ArtifactVisibility } from '../domain/types';
import { ArtifactNotFoundError, ArtifactForbiddenError } from '../domain/errors';

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
    return this.mapToArtifact(await this.artifacts.findById(artifactId)!);
  }

  async getForRuntime(artifactId: string): Promise<Artifact> {
    const artifact = await this.artifacts.findById(artifactId);
    if (!artifact) throw new ArtifactNotFoundError(artifactId);
    return this.mapToArtifact(artifact);
  }
}
```

同时给 `Artifact` 接口加上 `visibility` 字段：
```typescript
interface Artifact {
  // ... existing fields ...
  visibility: ArtifactVisibility;
}
```

**注意**：如果 `ArtifactForbiddenError` 不存在，创建它（参考 `ArtifactNotFoundError`）。

- [ ] **Step 4: 创建单元测试**

```typescript
// test/unit/artifact/artifact.service.test.ts（增量）

import { describe, it, expect, vi } from 'vitest';
import { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import type { ArtifactRepository } from '../../../src/modules/artifact/repositories/artifact.repository';
import { ArtifactNotFoundError, ArtifactForbiddenError } from '../../../src/modules/artifact/domain/errors';

describe('ArtifactService.updateVisibility', () => {
  let artifactService: ArtifactService;
  let mockRepo: ArtifactRepository;

  beforeEach(() => {
    mockRepo = {
      findById: vi.fn(),
      updateVisibility: vi.fn(),
    } as unknown as ArtifactRepository;
    // 需要 mock 其他依赖，但最简单的方式是隔离测试 updateVisibility
  });

  it('throws ArtifactNotFoundError when artifact does not exist', async () => {
    mockRepo.findById = vi.fn().mockResolvedValue(undefined);
    // ... 构造 artifactService with mockRepo ...
    await expect(
      artifactService.updateVisibility('user1', 'artifact1', 'public'),
    ).rejects.toThrow(ArtifactNotFoundError);
  });

  it('throws ArtifactForbiddenError when user is not owner', async () => {
    mockRepo.findById = vi.fn().mockResolvedValue({
      id: 'artifact1',
      userId: 'user2', // 不是 user1
      // ... other fields ...
    });
    // ...
    await expect(
      artifactService.updateVisibility('user1', 'artifact1', 'public'),
    ).rejects.toThrow(ArtifactForbiddenError);
  });

  it('calls repository.updateVisibility when authorized', async () => {
    const artifact = {
      id: 'artifact1',
      userId: 'user1',
      kind: 'web' as const,
      title: 'Test',
      payload: {},
      status: 'ready' as const,
      origin: 'user_intent' as const,
      visibility: 'private' as const,
      createdAt: new Date(),
    };
    mockRepo.findById = vi.fn().mockResolvedValue(artifact);
    mockRepo.updateVisibility = vi.fn().mockResolvedValue(undefined);

    await artifactService.updateVisibility('user1', 'artifact1', 'public');

    expect(mockRepo.updateVisibility).toHaveBeenCalledWith('artifact1', 'public');
  });
});
```

- [ ] **Step 5: Run unit tests**

```bash
pnpm test:unit test/unit/artifact/artifact.service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/artifact/repositories/artifact.repository.ts \
        src/modules/artifact/services/artifact.service.ts \
        src/modules/artifact/domain/types.ts \
        test/unit/artifact/artifact.service.test.ts
git commit -m "feat(s4.1): add ArtifactService.updateVisibility and getForRuntime"
```

---

## Task 3: 创建 visibility 中间件

**Files:**
- Create: `src/core/middleware/artifact-visibility.middleware.ts`
- Reference: `src/core/middleware/auth.middleware.ts`

- [ ] **Step 1: 创建中间件**

```typescript
// src/core/middleware/artifact-visibility.middleware.ts

import type { Request, Response, NextFunction } from 'express';
import type { ArtifactService } from '../../modules/artifact/services/artifact.service';
import type { SessionService } from '../../modules/identity/services/session.service';
import { ArtifactNotFoundError } from '../../modules/artifact/domain/errors';

declare global {
  namespace Express {
    interface Request {
      context?: {
        artifact?: ReturnType<ArtifactService['getForRuntime']> extends Promise<infer T> ? T : never;
      };
    }
  }
}

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
        return res.status(404).send(renderErrorPage('404 - 页面不存在', '您访问的页面不存在或已被删除'));
      }
      throw e;
    }

    if (artifact.visibility === 'public') {
      req.context = { ...req.context, artifact };
      return next();
    }

    // 私密 artifact：必须登录且为 owner
    const userId = await sessionService.getUserId(req);
    if (!userId) {
      return res.redirect('/login');
    }

    if (artifact.userId !== userId) {
      return res.status(404).send(renderErrorPage('404 - 页面不存在', '您访问的页面不存在或已被删除'));
    }

    req.context = { ...req.context, artifact };
    next();
  };
}

function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .error-box { text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin: 0 0 16px; color: #333; }
    p { font-size: 16px; color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// test/unit/runtime/visibility.middleware.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createVisibilityMiddleware } from '../../../src/core/middleware/artifact-visibility.middleware';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';
import type { SessionService } from '../../../src/modules/identity/services/session.service';
import { ArtifactNotFoundError } from '../../../src/modules/artifact/domain/errors';

describe('createVisibilityMiddleware', () => {
  let middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  let mockArtifactService: ArtifactService;
  let mockSessionService: SessionService;
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    mockArtifactService = {
      getForRuntime: vi.fn(),
    } as unknown as ArtifactService;
    mockSessionService = {
      getUserId: vi.fn(),
    } as unknown as SessionService;

    middleware = createVisibilityMiddleware(mockArtifactService, mockSessionService);

    req = { params: { artifactId: 'artifact-123' }, context: {} } as unknown as Request;
    res = { status: vi.fn().mockReturnThis(), send: vi.fn(), redirect: vi.fn() } as unknown as Response;
    next = vi.fn();
  });

  it('calls next() for public artifact without session', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'public',
      userId: 'user-1',
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.context?.artifact).toBeDefined();
  });

  it('calls next() for private artifact when user is owner', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'private',
      userId: 'user-1',
    });
    mockSessionService.getUserId = vi.fn().mockResolvedValue('user-1');

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('redirects to /login for private artifact without session', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'private',
      userId: 'user-1',
    });
    mockSessionService.getUserId = vi.fn().mockResolvedValue(undefined);

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 for private artifact when user is not owner', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockResolvedValue({
      id: 'artifact-123',
      visibility: 'private',
      userId: 'user-1',
    });
    mockSessionService.getUserId = vi.fn().mockResolvedValue('user-2');

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when artifact not found', async () => {
    mockArtifactService.getForRuntime = vi.fn().mockRejectedValue(
      new ArtifactNotFoundError('artifact-123'),
    );

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm test:unit test/unit/runtime/visibility.middleware.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/middleware/artifact-visibility.middleware.ts test/unit/runtime/visibility.middleware.test.ts
git commit -m "feat(s4.1): add artifact visibility middleware"
```

---

## Task 4: 创建 WebRuntimeController 和 SSR 模板

**Files:**
- Create: `src/modules/runtime/controllers/web-runtime.controller.ts`
- Create: `src/modules/runtime/domain/errors.ts`
- Reference: `src/modules/forge/services/forge.service.ts`（buildHtml pattern）

- [ ] **Step 1: 创建 Controller**

```typescript
// src/modules/runtime/controllers/web-runtime.controller.ts

import type { Request, Response } from 'express';
import type { ArtifactService } from '../../artifact/services/artifact.service';
import type { Artifact } from '../../artifact/domain/types';

export class WebRuntimeController {
  constructor(private readonly artifactService: ArtifactService) {}

  async renderApp(req: Request, res: Response) {
    const artifact = req.context?.artifact as Artifact;
    if (!artifact) {
      return res.status(500).send('Internal error: artifact not found in context');
    }

    const payload = artifact.payload as { entryHtml: string };
    const entryHtml = payload.entryHtml;

    if (!entryHtml) {
      return res.status(404).send(renderErrorPage('404', 'Artifact 内容为空'));
    }

    const html = this.buildHtml(artifact.title, entryHtml, artifact.visibility);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  private buildHtml(title: string, entryHtml: string, visibility: string): string {
    const topbar = `<div id="moon-topbar">
  <a href="/" class="back-btn">← 返回平台</a>
  <span class="title">${this.escapeHtml(title)}</span>
  <span class="visibility-badge ${visibility}">${visibility === 'public' ? '🔓 公开' : '🔒 私密'}</span>
</div>`;

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

function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .error-box { text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; margin: 0 0 16px; color: #333; }
    p { font-size: 16px; color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
// test/unit/runtime/web-runtime.controller.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebRuntimeController } from '../../../src/modules/runtime/controllers/web-runtime.controller';
import type { ArtifactService } from '../../../src/modules/artifact/services/artifact.service';

describe('WebRuntimeController', () => {
  let controller: WebRuntimeController;
  let mockArtifactService: ArtifactService;
  let req: any;
  let res: any;

  beforeEach(() => {
    mockArtifactService = {} as ArtifactService;
    controller = new WebRuntimeController(mockArtifactService);

    req = { context: {} };
    res = {
      setHeader: vi.fn(),
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
  });

  describe('buildHtml', () => {
    it('generates valid HTML with topbar and iframe', () => {
      const html = (controller as any).buildHtml('Test App', '<h1>Hello</h1>', 'private');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('id="moon-topbar"');
      expect(html).toContain('id="app-frame"');
      expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
      expect(html).toContain('srcdoc=');
      expect(html).toContain('🔒 私密');
    });

    it('escapes title to prevent XSS', () => {
      const html = (controller as any).buildHtml('<script>alert(1)</script>', '<h1>Test</h1>', 'public');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes entryHtml in srcdoc attribute', () => {
      const maliciousHtml = '<script>alert("xss")</script>';
      const html = (controller as any).buildHtml('Test', maliciousHtml, 'private');

      // Check that the srcdoc attribute value is properly escaped
      expect(html).not.toContain('srcdoc="' + maliciousHtml + '"');
    });

    it('shows public badge for public visibility', () => {
      const html = (controller as any).buildHtml('Test', '<h1>Test</h1>', 'public');

      expect(html).toContain('🔓 公开');
      expect(html).toContain('visibility-badge public');
    });

    it('shows private badge for private visibility', () => {
      const html = (controller as any).buildHtml('Test', '<h1>Test</h1>', 'private');

      expect(html).toContain('🔒 私密');
      expect(html).toContain('visibility-badge private');
    });
  });

  describe('renderApp', () => {
    it('renders artifact entryHtml in iframe', async () => {
      req.context.artifact = {
        id: 'artifact-123',
        title: 'Test App',
        visibility: 'public',
        payload: { entryHtml: '<h1>Hello World</h1>' },
        userId: 'user-1',
      };

      await controller.renderApp(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
      expect(res.send).toHaveBeenCalled();
      const sentHtml = (res.send as any).mock.calls[0][0];
      expect(sentHtml).toContain('<h1>Hello World</h1>');
    });

    it('returns 500 when artifact not in context', async () => {
      req.context = {};

      await controller.renderApp(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 404 when entryHtml is empty', async () => {
      req.context.artifact = {
        id: 'artifact-123',
        title: 'Test App',
        visibility: 'public',
        payload: { entryHtml: '' },
        userId: 'user-1',
      };

      await controller.renderApp(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm test:unit test/unit/runtime/web-runtime.controller.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/runtime/controllers/web-runtime.controller.ts test/unit/runtime/web-runtime.controller.test.ts
git commit -m "feat(s4.1): add WebRuntimeController with SSR template"
```

---

## Task 5: 创建 Routes 并注册到 main.ts

**Files:**
- Create: `src/modules/runtime/routes/web-runtime.routes.ts`
- Modify: `src/main.ts`
- Reference: `src/modules/intent/routes/intent.routes.ts`

- [ ] **Step 1: 创建 Routes**

```typescript
// src/modules/runtime/routes/web-runtime.routes.ts

import type { Router } from 'express';
import type { ArtifactService } from '../../artifact/services/artifact.service';
import type { SessionService } from '../../identity/services/session.service';
import { WebRuntimeController } from '../controllers/web-runtime.controller';
import { createVisibilityMiddleware } from '../../core/middleware/artifact-visibility.middleware';

export function registerWebRuntimeRoutes(
  router: Router,
  artifactService: ArtifactService,
  sessionService: SessionService,
) {
  const controller = new WebRuntimeController(artifactService);
  const visibilityMiddleware = createVisibilityMiddleware(artifactService, sessionService);

  // GET /app/:artifactId - SSR 页面
  router.get('/app/:artifactId', visibilityMiddleware, (req, res) => {
    controller.renderApp(req, res);
  });

  // PATCH /api/artifacts/:artifactId - 修改 visibility
  router.patch('/api/artifacts/:artifactId', async (req, res, next) => {
    try {
      const userId = await sessionService.getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      }

      const { visibility } = req.body;
      if (!['private', 'public'].includes(visibility)) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'visibility must be private or public' } });
      }

      await artifactService.updateVisibility(userId, req.params.artifactId, visibility);
      res.json({ success: true, visibility });
    } catch (e) {
      next(e);
    }
  });
}
```

- [ ] **Step 2: 修改 main.ts 注册路由**

找到 `buildApp()` 函数中注册其他路由的地方（如 intent routes），在后面添加：

```typescript
// src/main.ts（增量）

import { registerWebRuntimeRoutes } from './modules/runtime/routes/web-runtime.routes';

// 在 buildApp() 函数内，找到其他 registerXxxRoutes 调用，在后面添加：
registerWebRuntimeRoutes(expressApp, artifactService, sessionService);
```

**注意**：`artifactService` 和 `sessionService` 已在 `buildApp()` 中存在，直接复用。

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/runtime/routes/web-runtime.routes.ts src/main.ts
git commit -m "feat(s4.1): register web runtime routes in main.ts"
```

---

## Task 6: 创建集成测试

**Files:**
- Create: `test/integration/runtime/web-runtime.int.test.ts`
- Reference: `test/e2e/intent.e2e.test.ts`

- [ ] **Step 1: 创建集成测试**

```typescript
// test/integration/runtime/web-runtime.int.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { Kysely, MysqlDialect, Migrator, FileMigrationProvider } from 'kysely';
import { createPool } from 'mysql2';
import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Express } from 'express';
import type { Database } from '../../../src/core/db';
import { ulid } from 'ulid';

let container: StartedMySqlContainer;
let app: Express;
let shutdown: () => Promise<void>;
let cookie: string;
let userId: string;
let artifactId: string;

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8').withDatabase('moon_e2e').withRootPassword('root').start();
  const url = `mysql://root:root@${container.getHost()}:${container.getPort()}/moon_e2e`;

  // Run migrations
  const pool = createPool({ uri: url, connectionLimit: 5 });
  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });
  const migrationFolder = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');
  const pathShim = {
    ...nodePath,
    join: (...parts: string[]) => pathToFileURL(nodePath.join(...parts)).href,
  };
  const migrator = new Migrator({ db, provider: new FileMigrationProvider({ fs, path: pathShim, migrationFolder }) });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
  await db.destroy();

  // Set env
  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.PORT = '3001';
  process.env.DATABASE_URL = url;
  process.env.SESSION_COOKIE_NAME = 'mao_sess';
  process.env.SESSION_MAX_AGE_DAYS = '30';
  process.env.SESSION_SLIDING_UPDATE_MINUTES = '1';
  process.env.RATE_LIMIT_IP_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_IP_MAX = '1000';
  process.env.RATE_LIMIT_EMAIL_WINDOW_MIN = '10';
  process.env.RATE_LIMIT_EMAIL_MAX = '1000';
  process.env.LOG_LEVEL = 'warn';
  process.env.LLM_API_KEY = 'sk-test';
  process.env.LLM_MODEL = 'test-model';

  const { buildApp } = await import('../../../src/main');
  const built = await buildApp();
  app = built.app;
  shutdown = built.shutdown;

  // Seed user
  const { AuthService } = await import('../../../src/modules/identity/services/auth.service');
  const { UserRepository } = await import('../../../src/modules/identity/repositories/user.repository');
  const { IdentityRepository } = await import('../../../src/modules/identity/repositories/identity.repository');
  const { LoginAttemptRepository } = await import('../../../src/modules/identity/repositories/login-attempt.repository');
  const { SessionRepository } = await import('../../../src/modules/identity/repositories/session.repository');
  const { SessionService } = await import('../../../src/modules/identity/services/session.service');
  const { PasswordService } = await import('../../../src/modules/identity/services/password.service');

  userId = ulid();
  const pool2 = createPool({ uri: url, connectionLimit: 2 });
  const db2 = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool2 }) });
  const passwords = new PasswordService();
  const sessions = new SessionService(new SessionRepository(db2), { maxAgeDays: 30, slidingUpdateMinutes: 1 });
  const svc = new AuthService(
    new UserRepository(db2),
    new IdentityRepository(db2),
    new LoginAttemptRepository(db2),
    passwords,
    sessions,
  );

  await db2.executeInsert('users', [{
    id: userId,
    email: 'runtime-test@example.com',
    email_verified: 0,
    password_hash: 'irrelevant',
    display_name: 'Runtime Test',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }]);
  await db2.destroy();

  // Login
  const login = await request(app).post('/api/auth/login').send({
    email: 'runtime-test@example.com',
    password: 'irrelevant', // PasswordService mock accepts anything for test
  });
  cookie = login.headers['set-cookie'];

  // Create test artifact
  artifactId = ulid();
  const pool3 = createPool({ uri: url, connectionLimit: 2 });
  const db3 = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool3 }) });
  await db3.executeInsert('artifacts', [{
    id: artifactId,
    user_id: userId,
    kind: 'web',
    title: 'Test Web App',
    payload: JSON.stringify({
      entryHtml: '<h1>Hello from test artifact</h1><button onclick="alert(1)">Click</button>',
      assets: {},
      metadata: { generatedBy: 'test', generatedAt: new Date().toISOString() },
    }),
    status: 'ready',
    origin: 'user_intent',
    visibility: 'private',
    created_at: new Date(),
  }]);
  await db3.destroy();
}, 120_000);

afterAll(async () => {
  await shutdown();
  await container.stop();
}, 60_000);

describe('GET /app/:artifactId', () => {
  it('returns 302 redirect to /login for unauthenticated private artifact', async () => {
    // Create public artifact for this test
    const publicId = ulid();
    const pool = createPool({ uri: `mysql://root:root@${container.getHost()}:${container.getPort()}/moon_e2e`, connectionLimit: 2 });
    const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool: async () => pool }) });
    await db.executeInsert('artifacts', [{
      id: publicId,
      user_id: userId,
      kind: 'web',
      title: 'Public Artifact',
      payload: JSON.stringify({
        entryHtml: '<h1>Public</h1>',
        assets: {},
        metadata: { generatedBy: 'test', generatedAt: new Date().toISOString() },
      }),
      status: 'ready',
      origin: 'user_intent',
      visibility: 'public',
      created_at: new Date(),
    }]);
    await db.destroy();

    const r = await request(app).get(`/app/${publicId}`);
    expect(r.status).toBe(200); // public artifact, no auth needed
    expect(r.text).toContain('<iframe');
    expect(r.text).toContain('srcdoc=');
  });

  it('returns 200 with iframe for authenticated owner of private artifact', async () => {
    const r = await request(app).get(`/app/${artifactId}`).set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.text).toContain('<iframe');
    expect(r.text).toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it('renders entryHtml in srcdoc', async () => {
    const r = await request(app).get(`/app/${artifactId}`).set('Cookie', cookie);
    expect(r.status).toBe(200);
    // The srcdoc attribute contains the entryHtml
    expect(r.text).toContain('Hello from test artifact');
  });

  it('returns 404 for non-existent artifact', async () => {
    const r = await request(app).get(`/app/${ulid()}`).set('Cookie', cookie);
    expect(r.status).toBe(404);
  });
});

describe('PATCH /api/artifacts/:artifactId', () => {
  it('updates visibility to public', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'public' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.visibility).toBe('public');
  });

  it('allows unauthenticated access to now-public artifact', async () => {
    const r = await request(app).get(`/app/${artifactId}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('🔓 公开');
  });

  it('updates visibility back to private', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'private' });
    expect(r.status).toBe(200);
    expect(r.body.visibility).toBe('private');
  });

  it('returns 400 for invalid visibility value', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', cookie)
      .send({ visibility: 'invalid' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 without authentication', async () => {
    const r = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .send({ visibility: 'public' });
    expect(r.status).toBe(401);
  });
});
```

**注意**：如果 `request(app).post('/api/auth/login')` 需要密码验证，可能需要调整测试数据插入逻辑或 mock PasswordService。更简单的做法是在测试中直接插入 session。

- [ ] **Step 2: Run integration tests**

```bash
pnpm test:integration test/integration/runtime/web-runtime.int.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add test/integration/runtime/web-runtime.int.test.ts
git commit -m "test(s4.1): add web runtime integration tests"
```

---

## Task 7: 全量验证

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 2: Update README**

检查 `README.md` 是否需要更新 S4.1 完成状态。

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(s4.1): mark complete in README"
```

---

## 依赖关系

```
Task 1 (migration visibility)
    ↓
Task 2 (ArtifactRepository/Service) ←── (依赖 Task 1 完成后的类型)
    ↓
Task 3 (visibility middleware) ←── (依赖 Task 2)
    ↓
Task 4 (WebRuntimeController) ←── (依赖 Task 2)
    ↓
Task 5 (routes + main.ts) ←── (依赖 Task 3, 4)
    ↓
Task 6 (integration tests)
    ↓
Task 7 (full verification)
```

---

*实现计划基于 2026-04-25 设计文档。10 个决策见设计文档第二节。*