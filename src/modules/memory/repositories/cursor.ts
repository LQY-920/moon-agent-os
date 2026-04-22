export type CursorPayload = { t: Date; id: string };

export function encodeCursor(p: CursorPayload): string {
  const obj = { t: p.t.toISOString(), id: p.id };
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): CursorPayload {
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
