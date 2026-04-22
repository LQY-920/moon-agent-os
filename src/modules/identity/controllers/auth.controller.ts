import type { Request, Response, NextFunction } from 'express';
import { LoginInput } from '../schema';
import type { AuthService } from '../services/auth.service';
import type { AuthCtx } from '../../../middleware/require-session';

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookieName: string,
    private readonly maxAgeDays: number,
    private readonly isProd: boolean,
  ) {}

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = LoginInput.parse(req.body);
      const result = await this.auth.login({
        email: input.email,
        password: input.password,
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
      res.status(200).json({ user: result.user });
    } catch (e) { next(e); }
  };

  logout = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = res.locals.auth as AuthCtx;
      await this.auth.logout(auth.userId, auth.sessionId, new Date());
      res.clearCookie(this.cookieName, { path: '/' });
      res.status(204).send();
    } catch (e) { next(e); }
  };

  registerNotImplemented = (_req: Request, res: Response) => {
    res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'M0 不开放注册,请联系管理员用 CLI 创建账户' } });
  };
}
