import { describe, it, expect } from 'vitest';
import { AppError } from '../../../src/core/errors';

describe('AppError', () => {
  it('carries code, status and message', () => {
    class NotFoundError extends AppError {
      code = 'NOT_FOUND' as const;
      status = 404 as const;
    }
    const err = new NotFoundError('resource missing');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toBe('resource missing');
  });

  it('preserves stack trace', () => {
    class BoomError extends AppError {
      code = 'BOOM' as const;
      status = 500 as const;
    }
    const err = new BoomError('boom');
    expect(err.stack).toBeDefined();
  });
});
