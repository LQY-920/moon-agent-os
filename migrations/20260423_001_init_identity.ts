import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id              CHAR(26)      NOT NULL,
      email           VARCHAR(255)  NOT NULL,
      email_verified  TINYINT(1)    NOT NULL DEFAULT 0,
      password_hash   VARCHAR(255)  NULL,
      display_name    VARCHAR(64)   NOT NULL,
      status          ENUM('active','disabled','deleted') NOT NULL DEFAULT 'active',
      created_at      DATETIME(3)   NOT NULL,
      updated_at      DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE identities (
      id                CHAR(26)     NOT NULL,
      user_id           CHAR(26)     NOT NULL,
      provider          VARCHAR(32)  NOT NULL,
      provider_user_id  VARCHAR(255) NOT NULL,
      metadata          JSON         NULL,
      created_at        DATETIME(3)  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_provider_puid (provider, provider_user_id),
      KEY idx_user (user_id),
      CONSTRAINT fk_identities_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE sessions (
      id            CHAR(26)      NOT NULL,
      user_id       CHAR(26)      NOT NULL,
      token_hash    CHAR(64)      NOT NULL,
      user_agent    VARCHAR(512)  NULL,
      ip            VARCHAR(64)   NULL,
      created_at    DATETIME(3)   NOT NULL,
      last_seen_at  DATETIME(3)   NOT NULL,
      expires_at    DATETIME(3)   NOT NULL,
      revoked_at    DATETIME(3)   NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_token_hash (token_hash),
      KEY idx_user_active (user_id, revoked_at),
      KEY idx_expires (expires_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);

  await sql`
    CREATE TABLE login_attempts (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email         VARCHAR(255)    NULL,
      ip            VARCHAR(64)     NOT NULL,
      success       TINYINT(1)      NOT NULL,
      reason        VARCHAR(32)     NULL,
      attempted_at  DATETIME(3)     NOT NULL,
      PRIMARY KEY (id),
      KEY idx_ip_time (ip, attempted_at),
      KEY idx_email_time (email, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS login_attempts`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS identities`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
}
