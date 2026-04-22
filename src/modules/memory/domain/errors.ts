import { AppError } from '../../../core/errors';

export class ConversationNotFoundError extends AppError {
  readonly code = 'CONVERSATION_NOT_FOUND';
  readonly status = 404;
  constructor() { super('会话不存在'); }
}

export class ConversationForbiddenError extends AppError {
  readonly code = 'CONVERSATION_FORBIDDEN';
  readonly status = 403;
  constructor() { super('无权访问该会话'); }
}