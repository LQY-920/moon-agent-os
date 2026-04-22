import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';

export class IdentityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insertPassword(id: string, userId: string, email: string, now: Date): Promise<void> {
    await this.db.insertInto('identities').values({
      id,
      user_id: userId,
      provider: 'password',
      provider_user_id: email,
      metadata: null,
      created_at: now,
    }).execute();
  }
}
