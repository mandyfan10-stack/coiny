/** Canonical display name for notes-to-self (RU). */
export const SAVED_MESSAGES_DISPLAY_NAME = 'Избранное';

export type SavedMessagesChatLike = {
  type?: string | null;
  name?: string | null;
  createdBy?: string | null;
  /** Set by the data layer only for the ID returned by ensure_saved_messages_chat. */
  savedMessagesOwnerId?: string | null;
  members?: Array<{ id?: string | null } | null> | null;
} | null | undefined;

/**
 * Only a server-identified, self-owned chat with the owner as its sole member
 * can bypass personal E2EE. Display names and usernames are untrusted.
 */
export function isSavedMessagesChat(chat: SavedMessagesChatLike, currentUserId?: string | null): boolean {
  return Boolean(currentUserId && chat?.type === 'personal'
    && chat.savedMessagesOwnerId === currentUserId
    && chat.createdBy === currentUserId
    && chat.members?.length === 1
    && chat.members[0]?.id === currentUserId);
}

/** Personal 1:1 chats require E2EE; notes-to-self do not. */
export function requiresPersonalE2EE(chat: SavedMessagesChatLike, currentUserId?: string | null): boolean {
  if (!chat || chat.type !== 'personal') return false;
  return !isSavedMessagesChat(chat, currentUserId);
}

/** UI label: prefer canonical RU name for known saved chats. */
export function savedMessagesDisplayName(chat: SavedMessagesChatLike, currentUserId?: string | null): string {
  if (isSavedMessagesChat(chat, currentUserId)) return SAVED_MESSAGES_DISPLAY_NAME;
  return String(chat?.name || SAVED_MESSAGES_DISPLAY_NAME);
}
