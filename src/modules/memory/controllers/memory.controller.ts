import type { Request, Response, NextFunction } from 'express';
import type { AuthCtx } from '../../../middleware/require-session';
import type { MemoryService } from '../services/memory.service';
import {
  CreateConversationInput,
  AddMessageInput,
  ListConversationsQuery,
  ListMessagesQuery,
  ConversationIdParam,
} from '../schema';

export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  createConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const input = CreateConversationInput.parse(req.body ?? {});
      const c = await this.memory.createConversation(auth.userId, { title: input.title ?? null });
      res.status(201).json(c);
    } catch (e) { next(e); }
  };

  listConversations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const q = ListConversationsQuery.parse(req.query);
      const r = await this.memory.listConversations(auth.userId, { limit: q.limit, cursor: q.cursor });
      res.status(200).json(r);
    } catch (e) { next(e); }
  };

  getConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const c = await this.memory.getConversation(auth.userId, id);
      res.status(200).json(c);
    } catch (e) { next(e); }
  };

  deleteConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      await this.memory.deleteConversation(auth.userId, id);
      res.status(204).send();
    } catch (e) { next(e); }
  };

  addMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const input = AddMessageInput.parse(req.body);
      const m = await this.memory.addMessage(auth.userId, id, { role: input.role as any, content: input.content });
      res.status(201).json(m);
    } catch (e) { next(e); }
  };

  listMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = ConversationIdParam.parse(req.params);
      const q = ListMessagesQuery.parse(req.query);
      const r = await this.memory.listMessages(auth.userId, id, { limit: q.limit, cursor: q.cursor });
      res.status(200).json(r);
    } catch (e) { next(e); }
  };
}
