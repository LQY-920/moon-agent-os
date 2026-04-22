import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { RateLimitedError } from '../modules/identity/domain/errors';

export type RateLimitConfig = {
  ipWindowMin: number; ipMax: number;
  emailWindowMin: number; emailMax: number;
};

export function buildLoginRateLimiters(cfg: RateLimitConfig): { byIp: RequestHandler; byEmail: RequestHandler } {
  const byIp = rateLimit({
    windowMs: cfg.ipWindowMin * 60_000,
    limit: cfg.ipMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    skipSuccessfulRequests: true,
    handler: (_req, _res, next, options) => {
      const retry = Math.ceil(options.windowMs / 1000);
      next(new RateLimitedError(retry));
    },
  });
  const byEmail = rateLimit({
    windowMs: cfg.emailWindowMin * 60_000,
    limit: cfg.emailMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      return typeof body?.email === 'string' ? body.email.toLowerCase() : 'unknown';
    },
    skipSuccessfulRequests: true,
    handler: (_req, _res, next, options) => {
      const retry = Math.ceil(options.windowMs / 1000);
      next(new RateLimitedError(retry));
    },
  });
  return { byIp, byEmail };
}
