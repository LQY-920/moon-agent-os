import { Router, type RequestHandler } from 'express';
import type { MemoryController } from './controllers/memory.controller';

export function buildMemoryRoutes(opts: {
  memoryCtrl: MemoryController;
  requireSession: RequestHandler;
}): Router {
  const r = Router();
  const { memoryCtrl, requireSession } = opts;

  r.post('/conversations', requireSession, memoryCtrl.createConversation);
  r.get('/conversations', requireSession, memoryCtrl.listConversations);
  r.get('/conversations/:id', requireSession, memoryCtrl.getConversation);
  r.delete('/conversations/:id', requireSession, memoryCtrl.deleteConversation);
  r.post('/conversations/:id/messages', requireSession, memoryCtrl.addMessage);
  r.get('/conversations/:id/messages', requireSession, memoryCtrl.listMessages);

  return r;
}