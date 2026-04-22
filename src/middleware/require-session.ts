import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { SessionService } from '../modules/identity/services/session.service';
import { UnauthenticatedError } from '../modules/identity/domain/errors';

export type AuthCtx = { userId: string; sessionId: string };

export function requireSession(sessions: SessionService, cookieName: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const raw = cookies?.[cookieName];
      if (!raw) throw new UnauthenticatedError();
      const session = await sessions.validateAndTouch(raw, new Date());
      const auth: AuthCtx = { userId: session.userId, sessionId: session.id };
      res.locals.auth = auth;
      next();
    } catch (e) {
      next(e);
    }
  };
}
