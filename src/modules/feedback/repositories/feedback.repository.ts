import type { Kysely } from 'kysely';
import type { Database, FeedbackRow } from '../../../core/db';
import type { FeedbackLabel } from '../domain/feedback';

export class FeedbackRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(f: {
    id: string;
    artifactId: string;
    userId: string;
    label: FeedbackLabel;
    comment: string | null;
    now: Date;
  }): Promise<void> {
    await this.db.insertInto('feedbacks').values({
      id: f.id,
      artifact_id: f.artifactId,
      user_id: f.userId,
      label: f.label,
      comment: f.comment,
      created_at: f.now,
    }).execute();
  }

  async listByArtifact(artifactId: string): Promise<FeedbackRow[]> {
    return this.db
      .selectFrom('feedbacks')
      .selectAll()
      .where('artifact_id', '=', artifactId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async listByUserAndIntentKeyword(
    userId: string,
    keyword: string,
    limit: number,
  ): Promise<Array<FeedbackRow & { artifact_title: string }>> {
    const artifacts = await this.db
      .selectFrom('artifacts')
      .select(['id', 'title'])
      .where('user_id', '=', userId)
      .where('title', 'like', `%${keyword}%`)
      .execute();

    if (artifacts.length === 0) return [];

    const artifactIds = artifacts.map(a => a.id);
    const titleMap = new Map(artifacts.map(a => [a.id, a.title]));

    const rows = await this.db
      .selectFrom('feedbacks')
      .selectAll()
      .where('artifact_id', 'in', artifactIds)
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map(r => ({
      ...r,
      artifact_title: titleMap.get(r.artifact_id) ?? '',
    }));
  }
}
