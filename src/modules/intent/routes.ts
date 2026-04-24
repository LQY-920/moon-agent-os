import { Router, type RequestHandler } from 'express';
import type { IntentController } from './controllers/intent.controller';

export function buildIntentRoutes(opts: {
  intentCtrl: IntentController;
  requireSession: RequestHandler;
}): Router {
  const r = Router();
  const { intentCtrl, requireSession } = opts;

  r.post('/sessions', requireSession, intentCtrl.createSession);
  r.post('/sessions/:id/messages', requireSession, intentCtrl.sendMessage);

  return r;
}
