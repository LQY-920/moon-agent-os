import { Kysely, MysqlDialect, type Generated } from 'kysely';
import { createPool, type Pool } from 'mysql2';

export type UserRow = {
  id: string;
  email: string;
  email_verified: number;       // 0/1
  password_hash: string | null;
  display_name: string;
  status: 'active' | 'disabled' | 'deleted';
  created_at: Date;
  updated_at: Date;
};

export type IdentityRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  metadata: unknown | null;
  created_at: Date;
};

export type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

export type LoginAttemptRow = {
  id: Generated<number>;
  email: string | null;
  ip: string;
  success: number;
  reason: string | null;
  attempted_at: Date;
};

export type Database = {
  users: UserRow;
  identities: IdentityRow;
  sessions: SessionRow;
  login_attempts: LoginAttemptRow;
};

export function createDb(databaseUrl: string): { db: Kysely<Database>; pool: Pool } {
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    dateStrings: false,
    timezone: 'Z',
  });
  const db = new Kysely<Database>({
    dialect: new MysqlDialect({ pool: async () => pool }),
  });
  return { db, pool };
}
