import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE artifacts (
      id                  CHAR(26)      NOT NULL,
      user_id             CHAR(26)      NOT NULL,
      kind                VARCHAR(32)   NOT NULL,
      title               VARCHAR(200)  NOT NULL,
      payload             JSON          NOT NULL,
      status              VARCHAR(16)   NOT NULL DEFAULT 'ready',
      origin              VARCHAR(32)   NOT NULL,
      parent_artifact_id  CHAR(26)      NULL,
      created_at          DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_artifacts_user_created (user_id, created_at DESC),
      KEY idx_artifacts_user_kind_status (user_id, kind, status),
      KEY idx_artifacts_parent (parent_artifact_id),
      CONSTRAINT chk_artifacts_status CHECK (status IN ('ready','retired')),
      CONSTRAINT chk_artifacts_origin CHECK (origin IN ('user_intent','iteration','fork','install')),
      CONSTRAINT fk_artifacts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_artifacts_parent FOREIGN KEY (parent_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS artifacts`.execute(db);
}
