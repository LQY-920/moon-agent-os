import { AppError } from '../../../core/errors';

export class IntentMessageEmptyError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor() { super('消息内容不能为空'); }
}
