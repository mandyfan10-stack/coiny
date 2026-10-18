import type { ChatMessage } from '../types/message';

export type ForwardOrigin = { name: string };

export function decodeMessageContent<T extends { text?: string | null; isLocked?: boolean; forwardedFromRaw?: string | null; forwardedFrom?: ForwardOrigin | null }>(message: T): T {
  if (message.isLocked || !message.forwardedFromRaw) return message;
  try {
    const payload = JSON.parse(message.forwardedFromRaw);
    if (typeof payload.name !== 'string') return message;
    return { ...message, forwardedFrom: { name: payload.name.slice(0, 128) } };
  } catch { return message; }
}

export function canEditMessage(message: ChatMessage, userId?: string): boolean {
  return Boolean(userId && (message.senderId === userId || message.senderId === 'current')
    && !message.isLocked && !message.isPending && !message.isOptimistic && !message.isFailed
    && message.cryptoVersion !== 2 && !message.requiresUpdate
    && (!message.media || (message.text && !/^(sticker:|🎤|Голосовое сообщение|🎬|Видеосообщение|\[Видео\]|Видео$|Изображение$|🖼️)/.test(message.text))));
}

function revisionTime(value?: string | null): number {
  if (!value) return 0;
  // PostgreSQL revisions have microsecond precision; Date alone truncates it.
  const fraction = value.match(/\.(\d+)/)?.[1] || '';
  return new Date(value).getTime() * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function hasNewerMessageRevision(candidate: ChatMessage, current: ChatMessage): boolean {
  return revisionTime(candidate.editedAt) > revisionTime(current.editedAt);
}

export function preferMessageBody(current: ChatMessage, incoming: ChatMessage): ChatMessage {
  if (hasNewerMessageRevision(current, incoming)) {
    return { ...incoming, text: current.text, media: current.media, forwardedFrom: current.forwardedFrom,
      editedAt: current.editedAt, isLocked: current.isLocked };
  }
  return incoming;
}

export function preserveMessageRevisions(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map(message => [message.id, message]));
  return incoming.map(message => { const previous = byId.get(message.id); return previous ? preferMessageBody(previous, message) : message; });
}
