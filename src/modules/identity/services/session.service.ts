import * as crypto from 'node:crypto';
import { ulid } from 'ulid';
import type { SessionRepository } from '../repositories/session.repository';
import type { Session } from '../domain/session';
import { UnauthenticatedError } from '../domain/errors';

export type SessionConfig = {
  maxAgeDays: number;
  slidingUpdateMinutes: number;
};

export type CreateSessionResult = { rawToken: string; session: Session };

export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    private readonly cfg: SessionConfig,
  ) {}

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async create(opts: { userId: string; ip: string | null; userAgent: string | null; now: Date }): Promise<CreateSessionResult> {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const id = ulid();
    const expiresAt = new Date(opts.now.getTime() + this.cfg.maxAgeDays * 86_400_000);
    await this.repo.insert({
      id, userId: opts.userId, tokenHash: this.hashToken(rawToken),
      userAgent: opts.userAgent, ip: opts.ip, now: opts.now, expiresAt,
    });
    const session: Session = {
      id, userId: opts.userId, userAgent: opts.userAgent, ip: opts.ip,
      createdAt: opts.now, lastSeenAt: opts.now, expiresAt, revokedAt: null,
    };
    return { rawToken, session };
  }

  async validateAndTouch(rawToken: string, now: Date): Promise<Session> {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.repo.findActiveByTokenHash(tokenHash);
    if (!session) throw new UnauthenticatedError();
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.repo.revokeById(session.id, now);
      throw new UnauthenticatedError();
    }
    const slidingMs = this.cfg.slidingUpdateMinutes * 60_000;
    if (now.getTime() - session.lastSeenAt.getTime() > slidingMs) {
      await this.repo.touchLastSeen(session.id, now);
    }
    return session;
  }

  async revokeSession(userId: string, sessionId: string, now: Date): Promise<'revoked' | 'not_found' | 'already_revoked'> {
    const existing = await this.repo.findByIdForUser(sessionId, userId);
    if (!existing) return 'not_found';
    if (existing.revokedAt) return 'already_revoked';
    await this.repo.revokeById(sessionId, now);
    return 'revoked';
  }

  async revokeAll(userId: string, now: Date): Promise<void> {
    await this.repo.revokeAllForUser(userId, now);
  }

  async list(userId: string): Promise<Session[]> {
    return this.repo.listActiveByUser(userId);
  }
}
