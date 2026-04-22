import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { User, UserWithPassword } from '../domain/user';

function rowToUser(row: {
  id: string; email: string; email_verified: number; display_name: string;
  status: 'active' | 'disabled' | 'deleted'; created_at: Date; updated_at: Date;
}): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<UserWithPassword | null> {
    const row = await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    if (!row) return null;
    return { ...rowToUser(row), passwordHash: row.password_hash };
  }

  async insert(user: {
    id: string; email: string; passwordHash: string; displayName: string; now: Date;
  }): Promise<void> {
    await this.db.insertInto('users').values({
      id: user.id,
      email: user.email,
      email_verified: 0,
      password_hash: user.passwordHash,
      display_name: user.displayName,
      status: 'active',
      created_at: user.now,
      updated_at: user.now,
    }).execute();
  }

  async updatePasswordHash(id: string, hash: string, now: Date): Promise<void> {
    await this.db.updateTable('users')
      .set({ password_hash: hash, updated_at: now })
      .where('id', '=', id)
      .execute();
  }
}
