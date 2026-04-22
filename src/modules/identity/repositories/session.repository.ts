import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { Session } from '../domain/session';

function rowToSession(row: {
  id: string; user_id: string; user_agent: string | null; ip: string | null;
  created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null;
}): Session {
  return {
    id: row.id,
    userId: row.user_id,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class SessionRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(s: {
    id: string; userId: string; tokenHash: string;
    userAgent: string | null; ip: string | null;
    now: Date; expiresAt: Date;
  }): Promise<void> {
    await this.db.insertInto('sessions').values({
      id: s.id, user_id: s.userId, token_hash: s.tokenHash,
      user_agent: s.userAgent, ip: s.ip,
      created_at: s.now, last_seen_at: s.now, expires_at: s.expiresAt, revoked_at: null,
    }).execute();
  }

  async findActiveByTokenHash(tokenHash: string): Promise<Session | null> {
    const row = await this.db.selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async findByIdForUser(id: string, userId: string): Promise<Session | null> {
    const row = await this.db.selectFrom('sessions')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async listActiveByUser(userId: string): Promise<Session[]> {
    const rows = await this.db.selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(rowToSession);
  }

  async touchLastSeen(id: string, now: Date): Promise<void> {
    await this.db.updateTable('sessions')
      .set({ last_seen_at: now })
      .where('id', '=', id)
      .execute();
  }

  async revokeById(id: string, now: Date): Promise<void> {
    await this.db.updateTable('sessions')
      .set({ revoked_at: now })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db.updateTable('sessions')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async deleteStale(before: Date): Promise<number> {
    const res = await this.db.deleteFrom('sessions')
      .where((eb) => eb.or([
        eb('expires_at', '<', before),
        eb('revoked_at', '<', before),
      ]))
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }
}
