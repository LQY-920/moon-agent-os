import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE feedbacks (
      id          CHAR(26)      NOT NULL,
      artifact_id CHAR(26)      NOT NULL,
      user_id     CHAR(26)      NOT NULL,
      label       VARCHAR(32)   NOT NULL,
      comment     TEXT          NULL,
      created_at  DATETIME(3)   NOT NULL,
      PRIMARY KEY (id),
      KEY idx_feedbacks_artifact (artifact_id),
      KEY idx_feedbacks_user_created (user_id, created_at DESC),
      KEY idx_feedbacks_label (label),
      CONSTRAINT chk_feedbacks_label
        CHECK (label IN ('function_bug', 'ui_issue', 'slow_performance', 'missing_feature', 'other')),
      CONSTRAINT fk_feedbacks_artifact
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
      CONSTRAINT fk_feedbacks_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS feedbacks`.execute(db);
}
