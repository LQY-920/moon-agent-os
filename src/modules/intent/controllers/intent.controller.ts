import type { Request, Response, NextFunction } from 'express';
import type { AuthCtx } from '../../../middleware/require-session';
import type { IntentSessionService } from '../services/intent-session.service';
import { SendMessageBody, ConversationIdParam } from '../schema';

export class IntentController {
  constructor(private readonly intent: IntentSessionService) {}

  createSession = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const session = await this.intent.createSession(auth.userId);
      res.status(201).json({
        sessionId: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
      });
    } catch (e) { next(e); }
  };

  sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const body = SendMessageBody.parse(req.body ?? {});
      const result = await this.intent.sendMessage(auth.userId, id, body.message);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
