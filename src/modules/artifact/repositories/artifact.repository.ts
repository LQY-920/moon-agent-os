import type { Kysely } from 'kysely';
import type { Database } from '../../../core/db';
import type { Artifact, ArtifactKind, ArtifactOrigin, ArtifactStatus } from '../domain/artifact';

type CursorPayload = { t: Date; id: string };

function encodeCursor(p: CursorPayload): string {
  const obj = { t: p.t.toISOString(), id: p.id };
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCursor(s: string): CursorPayload {
  let parsed: unknown;
  try {
    const raw = Buffer.from(s, 'base64url').toString('utf8');
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_CURSOR');
  }
  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof (parsed as Record<string, unknown>).t !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new Error('INVALID_CURSOR');
  }
  const { t, id } = parsed as { t: string; id: string };
  const date = new Date(t);
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_CURSOR');
  return { t: date, id };
}

function rowToArtifact(row: {
  id: string; user_id: string; kind: string; title: string; payload: unknown;
  status: 'ready' | 'retired';
  origin: 'user_intent' | 'iteration' | 'fork' | 'install';
  parent_artifact_id: string | null;
  created_at: Date;
}): Artifact {
  // mysql2 returns JSON columns already parsed (object), but some edge cases
  // (e.g., older connector versions) return a string. Normalize defensively.
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    payload,
    status: row.status,
    origin: row.origin,
    parentArtifactId: row.parent_artifact_id,
    createdAt: row.created_at,
  };
}

export class ArtifactRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(a: {
    id: string;
    userId: string;
    kind: ArtifactKind;
    title: string;
    payload: unknown;
    status: ArtifactStatus;
    origin: ArtifactOrigin;
    parentArtifactId: string | null;
    now: Date;
  }): Promise<void> {
    // Kysely does NOT auto-stringify for JSON columns; mysql2 would send
    // "[object Object]" unless we stringify first.
    await this.db.insertInto('artifacts').values({
      id: a.id,
      user_id: a.userId,
      kind: a.kind,
      title: a.title,
      payload: JSON.stringify(a.payload) as unknown,   // cast because column type is `unknown`
      status: a.status,
      origin: a.origin,
      parent_artifact_id: a.parentArtifactId,
      created_at: a.now,
    }).execute();
  }

  async findById(id: string): Promise<Artifact | null> {
    const row = await this.db.selectFrom('artifacts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? rowToArtifact(row) : null;
  }

  async listByUser(userId: string, opts: {
    limit: number;
    cursor?: string | null;
    kind?: ArtifactKind;
    status?: ArtifactStatus;
  }): Promise<{ items: Artifact[]; nextCursor: string | null }> {
    let query = this.db.selectFrom('artifacts')
      .selectAll()
      .where('user_id', '=', userId);

    if (opts.kind !== undefined) {
      query = query.where('kind', '=', opts.kind);
    }
    if (opts.status !== undefined) {
      query = query.where('status', '=', opts.status);
    }
    if (opts.cursor) {
      const { t, id } = decodeCursor(opts.cursor);
      // (created_at, id) < (cursor.t, cursor.id) for DESC pagination
      query = query.where((eb) => eb.or([
        eb('created_at', '<', t),
        eb.and([eb('created_at', '=', t), eb('id', '<', id)]),
      ]));
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(opts.limit + 1)
      .execute();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(rowToArtifact);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ t: last.createdAt, id: last.id })
      : null;

    return { items, nextCursor };
  }

  async updateStatus(id: string, status: ArtifactStatus): Promise<void> {
    await this.db.updateTable('artifacts')
      .set({ status })
      .where('id', '=', id)
      .execute();
  }
}
