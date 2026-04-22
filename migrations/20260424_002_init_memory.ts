import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE conversations (
      id           CHAR(26)      NOT NULL,
      user_id      CHAR(26)      NOT NULL,
      title        VARCHAR(200)  NULL,
      created_at   DATETIME(3)   NOT NULL,
      updated_at   DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_conversations_user_updated (user_id, updated_at DESC),
      CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE messages (
      id              CHAR(26)      NOT NULL,
      conversation_id CHAR(26)      NOT NULL,
      role            VARCHAR(16)   NOT NULL,
      content         TEXT          NOT NULL,
      created_at      DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_messages_conversation_created (conversation_id, created_at),
      CONSTRAINT chk_messages_role CHECK (role IN ('user','ai','system')),
      CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS messages`.execute(db);
  await sql`DROP TABLE IF EXISTS conversations`.execute(db);
}
