import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';

export class LoginAttemptRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(a: {
    email: string | null; ip: string; success: boolean; reason: string | null; now: Date;
  }): Promise<void> {
    await this.db.insertInto('login_attempts').values({
      email: a.email,
      ip: a.ip,
      success: a.success ? 1 : 0,
      reason: a.reason,
      attempted_at: a.now,
    }).execute();
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const res = await this.db.deleteFrom('login_attempts')
      .where('attempted_at', '<', before)
      .executeTakeFirst();
    return Number(res.numDeletedRows);
  }
}
