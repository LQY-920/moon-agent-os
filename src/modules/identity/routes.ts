import { Router, type RequestHandler } from 'express';
import type { AuthController } from './controllers/auth.controller';
import type { MeController } from './controllers/me.controller';

export function buildIdentityRoutes(opts: {
  authCtrl: AuthController;
  meCtrl: MeController;
  requireSession: RequestHandler;
  loginRateLimiters: { byIp: RequestHandler; byEmail: RequestHandler };
}): Router {
  const r = Router();
  const { authCtrl, meCtrl, requireSession, loginRateLimiters } = opts;

  r.post('/auth/login', loginRateLimiters.byIp, loginRateLimiters.byEmail, authCtrl.login);
  r.post('/auth/logout', requireSession, authCtrl.logout);
  r.post('/auth/register', authCtrl.registerNotImplemented);
  r.post('/auth/verify-email', authCtrl.registerNotImplemented);
  r.post('/auth/password-reset/request', authCtrl.registerNotImplemented);
  r.post('/auth/password-reset/confirm', authCtrl.registerNotImplemented);

  r.get('/me', requireSession, meCtrl.get);
  r.get('/me/sessions', requireSession, meCtrl.listSessions);
  r.delete('/me/sessions/:id', requireSession, meCtrl.revokeSession);
  r.post('/me/password', requireSession, meCtrl.changePassword);

  return r;
}
