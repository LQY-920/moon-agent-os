import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. 新增 visibility 列，默认 'private'
  await sql`ALTER TABLE artifacts ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private'`.execute(db);

  // 2. 约束：只允许 'private' | 'public'
  await sql`ALTER TABLE artifacts ADD CONSTRAINT chk_artifacts_visibility CHECK (visibility IN ('private', 'public'))`.execute(db);

  // 3. 索引：按 visibility 查询（未来画廊页）
  await sql`ALTER TABLE artifacts ADD KEY idx_artifacts_visibility (visibility)`.execute(db);

  // 4. 组合索引：(user_id, visibility)
  await sql`ALTER TABLE artifacts ADD KEY idx_artifacts_user_visibility (user_id, visibility)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE artifacts DROP COLUMN visibility`.execute(db);
}
