import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../core/db';
import type { Message, MessageRole } from '../domain/message';
import { encodeCursor, decodeCursor, type CursorPayload } from './cursor';

function rowToMessage(row: {
  id: string; conversation_id: string; role: 'user' | 'ai' | 'system';
  content: string; created_at: Date;
}): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

type Executor = Kysely<Database> | Transaction<Database>;

export class MessageRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(
    m: { id: string; conversationId: string; role: MessageRole; content: string; now: Date },
    executor?: Executor,
  ): Promise<void> {
    const exec = executor ?? this.db;
    await exec.insertInto('messages').values({
      id: m.id,
      conversation_id: m.conversationId,
      role: m.role,
      content: m.content,
      created_at: m.now,
    }).execute();
  }

  async listByConversation(conversationId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Message[]; nextCursor: string | null }> {

    let query = this.db.selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', conversationId);

    if (opts.cursor) {
      const { t, id } = decodeCursor(opts.cursor);
      query = query.where((eb) => eb.or([
        eb('created_at', '>', t),
        eb.and([eb('created_at', '=', t), eb('id', '>', id)]),
      ]));
    }

    const rows = await query
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(opts.limit + 1)
      .execute();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(rowToMessage);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.createdAt, id: last.id } satisfies CursorPayload)
      : null;

    return { items, nextCursor };
  }
}