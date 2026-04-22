import { AppError } from '../../../core/errors';

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly status = 401;
  constructor() { super('邮箱或密码错误'); }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly status = 401;
  constructor() { super('未登录或会话已失效'); }
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  constructor(readonly retryAfterSec: number) { super(`请稍后再试(${retryAfterSec}s)`); }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;
  constructor(msg = '资源不存在') { super(msg); }
}

export class WeakPasswordError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor(readonly details: Record<string, string>) { super('密码不符合安全要求'); }
}

export class EmailAlreadyUsedError extends AppError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 400;
  constructor() { super('邮箱已被注册'); }
}
