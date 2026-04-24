import type { Router } from 'express';
import type { ArtifactService } from '../../artifact/services/artifact.service';
import type { SessionService } from '../../identity/services/session.service';
import { WebRuntimeController } from '../controllers/web-runtime.controller';
import { createVisibilityMiddleware } from '../../../core/middleware/artifact-visibility.middleware';

export function registerWebRuntimeRoutes(
  router: Router,
  artifactService: ArtifactService,
  sessionService: SessionService,
  cookieName: string,
) {
  const controller = new WebRuntimeController();
  const visibilityMiddleware = createVisibilityMiddleware(artifactService, sessionService, cookieName);

  // GET /app/:artifactId - SSR 页面
  router.get('/app/:artifactId', visibilityMiddleware, (req, res) => {
    controller.renderApp(req, res);
  });

  // PATCH /api/artifacts/:artifactId - 修改 visibility
  router.patch('/api/artifacts/:artifactId', async (req, res, next) => {
    try {
      const userId = await sessionService.getUserId(req, cookieName);
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
