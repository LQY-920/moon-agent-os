import { AppError } from '../../../core/errors';

export class ArtifactNotFoundError extends AppError {
  readonly code = 'ARTIFACT_NOT_FOUND';
  readonly status = 404;
  constructor() { super('产物不存在'); }
}

export class ArtifactForbiddenError extends AppError {
  readonly code = 'ARTIFACT_FORBIDDEN';
  readonly status = 403;
  constructor() { super('无权访问该产物'); }
}

export class InvalidPayloadError extends AppError {
  readonly code = 'INVALID_ARTIFACT_PAYLOAD';
  readonly status = 400;
  constructor(message: string, readonly details?: unknown) { super(message); }
}
