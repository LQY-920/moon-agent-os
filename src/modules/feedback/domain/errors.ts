import { AppError } from '../../../core/errors';

export class FeedbackNotFoundError extends AppError {
  readonly code = 'FEEDBACK_NOT_FOUND';
  readonly status = 404;
  constructor(artifactId: string) { super(`产物 ${artifactId} 不存在`); }
}

export class FeedbackForbiddenError extends AppError {
  readonly code = 'FEEDBACK_FORBIDDEN';
  readonly status = 403;
  constructor() { super('无权对该产物提交反馈'); }
}