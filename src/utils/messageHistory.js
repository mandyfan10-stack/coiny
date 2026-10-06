import { compareMessages, getMessageCursor } from './messageCursor.ts';

/** A full page only verifies the range from its oldest row onwards. */
export function createHistorySnapshot(messages, pageSize) {
  const hasMore = messages.length >= pageSize;
  const oldest = [...messages].sort(compareMessages)[0];
  return {
    ids: new Set(messages.map((message) => message.id)),
    oldestCursor: hasMore ? getMessageCursor(oldest) : null,
    hasMore
  };
}

export function retainCachedMessage(message, snapshot) {
  return Boolean(message.isPending || message.isOptimistic || message.isFailed
    || snapshot.ids.has(message.id)
    || (snapshot.oldestCursor && compareMessages(message, snapshot.oldestCursor) < 0));
}
