import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../core/errors';
import type { Logger } from '../core/logger';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const requestId = res.locals.requestId as string | undefined;
    if (err instanceof AppError) {
      const body: Record<string, unknown> = {
        error: { code: err.code, message: err.message },
      };
      if ('retryAfterSec' in err && typeof err.retryAfterSec === 'number') {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        (body.error as Record<string, unknown>).retryAfter = err.retryAfterSec;
      }
      if ('details' in err && err.details) {
        (body.error as Record<string, unknown>).details = err.details;
      }
      res.status(err.status).json(body);
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: '请求参数校验失败',
          details: err.flatten().fieldErrors,
        },
      });
      return;
    }
    logger.error({ err, requestId }, 'unhandled_error');
    res.status(500).json({
      error: { code: 'INTERNAL', message: '服务器内部错误', requestId },
    });
  };
}
