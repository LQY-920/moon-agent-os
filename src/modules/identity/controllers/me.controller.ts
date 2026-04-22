import type { Request, Response, NextFunction } from 'express';
import { ChangePasswordInput, SessionIdParam } from '../schema';
import type { AuthService } from '../services/auth.service';
import type { SessionService } from '../services/session.service';
import type { UserRepository } from '../repositories/user.repository';
import type { AuthCtx } from '../../../middleware/require-session';
import { NotFoundError, UnauthenticatedError } from '../domain/errors';

export class MeController {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly cookieName: string,
    private readonly maxAgeDays: number,
    private readonly isProd: boolean,
  ) {}

  get = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = res.locals.auth as AuthCtx;
      const user = await this.users.findById(userId);
      if (!user) throw new UnauthenticatedError();
      res.status(200).json({ user });
    } catch (e) { next(e); }
  };

  listSessions = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const list = await this.sessions.list(auth.userId);
      res.status(200).json({
        sessions: list.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
          current: s.id === auth.sessionId,
        })),
      });
    } catch (e) { next(e); }
  };

  revokeSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const { id } = SessionIdParam.parse(req.params);
      const result = await this.sessions.revokeSession(auth.userId, id, new Date());
      if (result === 'not_found') throw new NotFoundError('会话不存在');
      if (id === auth.sessionId) res.clearCookie(this.cookieName, { path: '/' });
      res.status(204).send();
    } catch (e) { next(e); }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      const input = ChangePasswordInput.parse(req.body);
      const result = await this.auth.changePassword({
        userId: auth.userId,
        oldPassword: input.oldPassword,
        newPassword: input.newPassword,
        ip: req.ip ?? 'unknown',
        userAgent: req.header('user-agent') ?? null,
        now: new Date(),
      });
      res.cookie(this.cookieName, result.rawToken, {
        httpOnly: true,
        secure: this.isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: this.maxAgeDays * 86_400_000,
      });
      res.status(204).send();
    } catch (e) { next(e); }
  };
}
