export interface IndexedMessage {
  id: string;
  senderId?: string;
  replyTo?: string | null;
  read?: boolean;
}

/** Shared render lookups: one pass per history revision, not one scan per bubble. */
export function buildMessageListIndex<T extends IndexedMessage>(messages: readonly T[], currentUserId?: string, unreadCount = 0): {
  messagesById: ReadonlyMap<string, T>;
  firstUnreadIndex: number;
} {
  const messagesById = new Map<string, T>();
  let firstUnreadIndex = unreadCount > 0 ? messages.length - unreadCount : -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    // Preserve Array.find's first-match behavior even for a transient duplicate.
    if (!messagesById.has(message.id)) messagesById.set(message.id, message);
    if (unreadCount <= 0 && firstUnreadIndex < 0 && message.senderId !== currentUserId
      && message.senderId !== 'current' && !message.read) firstUnreadIndex = index;
  }
  return { messagesById, firstUnreadIndex };
}
