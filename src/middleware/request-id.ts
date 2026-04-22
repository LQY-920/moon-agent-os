import type { Request, Response, NextFunction } from 'express';
import { ulid } from 'ulid';

export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[A-Za-z0-9_-]{1,64}$/.test(incoming) ? incoming : ulid();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  };
}
