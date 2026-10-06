export type MessageCursor = { timestamp: string; id: string };

type MessageOrderLike = {
  id?: string | null;
  timestamp?: Date | string | null;
  timestampIso?: string | null;
  /** Original server timestamp, including Postgres microseconds. */
  createdAt?: string | null;
};

function timestampOf(message: MessageOrderLike): Date | string | null | undefined {
  return message.createdAt || message.timestampIso || message.timestamp;
}

function microseconds(timestamp: Date | string | null | undefined): number {
  const milliseconds = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp || '').getTime();
  const fraction = typeof timestamp === 'string'
    ? timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] || ''
    : '';
  return milliseconds * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function getMessageCursor(message?: MessageOrderLike | null): MessageCursor | null {
  if (!message?.id) return null;
  const timestamp = timestampOf(message);
  if (!Number.isFinite(microseconds(timestamp))) return null;
  return { id: message.id, timestamp: timestamp instanceof Date ? timestamp.toISOString() : String(timestamp) };
}

/** Same ascending (created_at, id) order as the server's history query. */
export function compareMessages(left: MessageOrderLike, right: MessageOrderLike): number {
  const timeDifference = microseconds(timestampOf(left)) - microseconds(timestampOf(right));
  if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
  const leftId = String(left.id || '');
  const rightId = String(right.id || '');
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
