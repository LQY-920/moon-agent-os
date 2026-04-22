import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { Conversation } from '../domain/conversation';
import { encodeCursor, decodeCursor, type CursorPayload } from './cursor';

function rowToConversation(row: {
  id: string; user_id: string; title: string | null;
  created_at: Date; updated_at: Date;
}): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConversationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(
    c: { id: string; userId: string; title: string | null; now: Date },
    executor?: Kysely<Database>,
  ): Promise<void> {
    const exec = executor ?? this.db;
    await exec.insertInto('conversations').values({
      id: c.id,
      user_id: c.userId,
      title: c.title,
      created_at: c.now,
      updated_at: c.now,
    }).execute();
  }

  async findById(id: string): Promise<Conversation | null> {
    const row = await this.db.selectFrom('conversations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? rowToConversation(row) : null;
  }

  async listByUser(userId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Conversation[]; nextCursor: string | null }> {

    let query = this.db.selectFrom('conversations')
      .selectAll()
      .where('user_id', '=', userId);

    if (opts.cursor) {
      const { t, id } = decodeCursor(opts.cursor);
      query = query.where((eb) => eb.or([
        eb('updated_at', '<', t),
        eb.and([eb('updated_at', '=', t), eb('id', '<', id)]),
      ]));
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit + 1)
      .execute();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(rowToConversation);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.updatedAt, id: last.id } satisfies CursorPayload)
      : null;

    return { items, nextCursor };
  }

  async touchUpdatedAt(
    id: string,
    now: Date,
    executor?: Kysely<Database>,
  ): Promise<void> {
    const exec = executor ?? this.db;
    await exec.updateTable('conversations')
      .set({ updated_at: now })
      .where('id', '=', id)
      .execute();
  }

  async deleteById(id: string): Promise<void> {
    await this.db.deleteFrom('conversations')
      .where('id', '=', id)
      .execute();
  }
}