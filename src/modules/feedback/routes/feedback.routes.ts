import type { Router } from 'express';
import type { FeedbackService } from '../services/feedback.service';
import type { SessionService } from '../../identity/services/session.service';
import { FeedbackController } from '../controllers/feedback.controller';
import { requireSession } from '../../../middleware/require-session';

export function registerFeedbackRoutes(
  router: Router,
  feedbackService: FeedbackService,
  sessionService: SessionService,
  cookieName: string,
) {
  const controller = new FeedbackController(feedbackService);
  const auth = requireSession(sessionService, cookieName);

  router.post('/api/feedback', auth, (req, res, next) => controller.create(req, res, next));
  router.get('/api/artifacts/:id/feedback', auth, (req, res, next) => controller.listByArtifact(req, res, next));
}
