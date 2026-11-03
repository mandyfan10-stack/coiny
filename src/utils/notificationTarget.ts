export interface NotificationTarget {
  chatId: string;
  ownerId: string;
  messageId?: string;
}

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,128}$/;

/** Notification data is untrusted; it can select an existing chat, never join one. */
export function parseNotificationTarget(value: unknown): NotificationTarget | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.chatId !== 'string' || !IDENTIFIER.test(data.chatId)
    || typeof data.ownerId !== 'string' || !IDENTIFIER.test(data.ownerId)) return null;
  return {
    chatId: data.chatId,
    ownerId: data.ownerId,
    ...(typeof data.messageId === 'string' && IDENTIFIER.test(data.messageId) ? { messageId: data.messageId } : {})
  };
}

export function notificationTargetFromUrl(href: string): NotificationTarget | null {
  const url = new URL(href);
  return parseNotificationTarget({
    chatId: url.searchParams.get('notificationChat'),
    ownerId: url.searchParams.get('notificationOwner')
  });
}

export function withoutNotificationTarget(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('notificationChat');
  url.searchParams.delete('notificationOwner');
  return url.href;
}

export function canOpenNotificationTarget(target: NotificationTarget, userId: string | null | undefined, chats: ReadonlyArray<{ id: string }>): boolean {
  return target.ownerId === userId && chats.some(chat => chat.id === target.chatId);
}
