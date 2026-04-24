import type { Request, Response, NextFunction } from 'express';
import type { ArtifactService } from '../../modules/artifact/services/artifact.service';
import type { SessionService } from '../../modules/identity/services/session.service';
import { ArtifactNotFoundError } from '../../modules/artifact/domain/errors';

declare global {
  namespace Express {
    interface Request {
      context?: {
        artifact?: Awaited<ReturnType<ArtifactService['getForRuntime']>>;
      };
    }
  }
}

export function createVisibilityMiddleware(
  artifactService: ArtifactService,
  sessionService: SessionService,
  cookieName: string,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const artifactId = (req.params as Record<string, string>).artifactId;
    if (!artifactId) {
      next();
      return;
    }

    let artifact;
    try {
      artifact = await artifactService.getForRuntime(artifactId);
    } catch (e) {
      if (e instanceof ArtifactNotFoundError) {
        res.status(404).send(renderErrorPage('404 - 页面不存在', '您访问的页面不存在或已被删除'));
        return;
      }
      throw e;
    }

    if (artifact.visibility === 'public') {
      req.context = { ...req.context, artifact };
      next();
      return;
    }

    // 私密 artifact：必须登录且为 owner
    const userId = await sessionService.getUserId(req, cookieName);
    if (!userId) {
      res.redirect('/login');
      return;
    }

    if (artifact.userId !== userId) {
      res.status(404).send(renderErrorPage('404 - 页面不存在', '您访问的页面不存在或已被删除'));
      return;
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
