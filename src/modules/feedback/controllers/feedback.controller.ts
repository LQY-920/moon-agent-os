import type { Request, Response, NextFunction } from 'express';
import type { FeedbackService } from '../services/feedback.service';
import type { FeedbackLabel } from '../domain/feedback';
import { FEEDBACK_LABELS } from '../domain/feedback';
import type { AuthCtx } from '../../../middleware/require-session';

export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = res.locals.auth as AuthCtx;

      const { artifact_id, label, comment } = req.body as {
        artifact_id: string;
        label: string;
        comment?: string;
      };
      if (!artifact_id || !label) {
        return res.status(400).json({ error: { code: 'VALIDATION_FAILED' } });
      }
      if (!FEEDBACK_LABELS.includes(label as FeedbackLabel)) {
        return res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: `label must be one of: ${FEEDBACK_LABELS.join(', ')}` }
        });
      }

      await this.feedbackService.create(userId, artifact_id, label as FeedbackLabel, comment ?? null);
      res.status(201).json({ success: true });
    } catch (e) {
      next(e);
    }
  }

  async listByArtifact(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = res.locals.auth as AuthCtx;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const feedbacks = await this.feedbackService.listByArtifactForOwner(userId, id);
      res.json({ items: feedbacks });
    } catch (e) {
      next(e);
    }
  }
}