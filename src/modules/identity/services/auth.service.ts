import { ulid } from 'ulid';
import type { UserRepository } from '../repositories/user.repository';
import type { IdentityRepository } from '../repositories/identity.repository';
import type { LoginAttemptRepository } from '../repositories/login-attempt.repository';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';
import type { User } from '../domain/user';
import { InvalidCredentialsError, EmailAlreadyUsedError, WeakPasswordError } from '../domain/errors';
import { authEvents } from '../events';

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly identities: IdentityRepository,
    private readonly attempts: LoginAttemptRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async login(opts: { email: string; password: string; ip: string; userAgent: string | null; now: Date }):
    Promise<{ user: User; rawToken: string; sessionId: string }>
  {
    const found = await this.users.findByEmail(opts.email);
    if (!found || !found.passwordHash || found.status !== 'active') {
      await this.attempts.insert({ email: opts.email, ip: opts.ip, success: false, reason: 'unknown_email', now: opts.now });
      authEvents.emit('login_failure', { type: 'login_failure', email: opts.email, ip: opts.ip, reason: 'unknown_email' });
      throw new InvalidCredentialsError();
    }
    const ok = await this.passwords.verify(found.passwordHash, opts.password);
    if (!ok) {
      await this.attempts.insert({ email: opts.email, ip: opts.ip, success: false, reason: 'bad_password', now: opts.now });
      authEvents.emit('login_failure', { type: 'login_failure', email: opts.email, ip: opts.ip, reason: 'bad_password' });
      throw new InvalidCredentialsError();
    }
    await this.attempts.insert({ email: opts.email, ip: opts.ip, success: true, reason: null, now: opts.now });
    const { rawToken, session } = await this.sessions.create({
      userId: found.id, ip: opts.ip, userAgent: opts.userAgent, now: opts.now,
    });
    authEvents.emit('login_success', {
      type: 'login_success', userId: found.id, sessionId: session.id, ip: opts.ip, ua: opts.userAgent ?? undefined,
    });
    const { passwordHash, ...user } = found;
    void passwordHash;
    return { user, rawToken, sessionId: session.id };
  }

  async logout(userId: string, sessionId: string, now: Date): Promise<void> {
    await this.sessions.revokeSession(userId, sessionId, now);
    authEvents.emit('logout', { type: 'logout', userId, sessionId });
    authEvents.emit('session_revoked', { type: 'session_revoked', userId, sessionId, by: 'user' });
  }

  async changePassword(opts: { userId: string; oldPassword: string; newPassword: string; ip: string; userAgent: string | null; now: Date }):
    Promise<{ rawToken: string; sessionId: string }>
  {
    const fullUser = await this.findUserWithPasswordById(opts.userId);
    if (!fullUser || !fullUser.passwordHash) throw new InvalidCredentialsError();
    const ok = await this.passwords.verify(fullUser.passwordHash, opts.oldPassword);
    if (!ok) throw new InvalidCredentialsError();
    if (opts.oldPassword === opts.newPassword) {
      throw new WeakPasswordError({ password: '新密码不能与旧密码相同' });
    }
    this.passwords.checkStrength(opts.newPassword);
    const newHash = await this.passwords.hash(opts.newPassword);
    await this.users.updatePasswordHash(opts.userId, newHash, opts.now);
    await this.sessions.revokeAll(opts.userId, opts.now);
    const { rawToken, session } = await this.sessions.create({
      userId: opts.userId, ip: opts.ip, userAgent: opts.userAgent, now: opts.now,
    });
    authEvents.emit('password_changed', { type: 'password_changed', userId: opts.userId });
    authEvents.emit('session_revoked', { type: 'session_revoked', userId: opts.userId, sessionId: 'all', by: 'password_change' });
    return { rawToken, sessionId: session.id };
  }

  private async findUserWithPasswordById(id: string) {
    return this.users.findByIdWithPassword(id);
  }

  async register(opts: { email: string; password: string; displayName: string; via: 'cli' | 'register'; now: Date }): Promise<string> {
    const existing = await this.users.findByEmail(opts.email);
    if (existing) throw new EmailAlreadyUsedError();
    this.passwords.checkStrength(opts.password);
    const hash = await this.passwords.hash(opts.password);
    const userId = ulid();
    const identityId = ulid();
    await this.users.insert({
      id: userId, email: opts.email, passwordHash: hash, displayName: opts.displayName, now: opts.now,
    });
    await this.identities.insertPassword(identityId, userId, opts.email, opts.now);
    authEvents.emit('user_created', { type: 'user_created', userId, via: opts.via });
    return userId;
  }
}
