/**
 * Pure view-model helpers for ChatArea: permissions, wallpaper, search,
 * unread/date dividers, recording gestures and media captions.
 */

interface ChatLike {
  id?: string;
  type?: string;
  createdBy?: string | null;
  requiresUpdate?: boolean;
  settings?: { only_admins_can_post?: boolean; allow_media?: boolean } | null;
  unread_count?: number;
  messages?: MessageLike[];
}

interface MessageLike {
  id: string;
  senderId?: string;
  text?: string | null;
  read?: boolean;
  timestamp?: Date | string | number | null;
}

// ---------------------------------------------------------------- permissions

export interface ChatPermissions {
  isOwner: boolean;
  canPost: boolean;
  canSendMedia: boolean;
}

export function getChatPermissions(chat: ChatLike | null | undefined, currentUserId: string | null | undefined): ChatPermissions {
  const isOwner = Boolean(chat && currentUserId && (
    chat.createdBy === currentUserId || chat.createdBy === 'current'
  ));
  const canPost = !chat?.requiresUpdate && (!chat ||
    chat.type === 'personal' ||
    isOwner ||
    (chat.type === 'group' && !chat.settings?.only_admins_can_post));
  const canSendMedia = !chat ||
    chat.type === 'personal' ||
    isOwner ||
    chat.settings?.allow_media !== false;
  return { isOwner, canPost, canSendMedia };
}

// ------------------------------------------------------------------ wallpaper

const BUILT_IN_WALLPAPERS = new Set(['classic', 'default']);
const DIRECT_URL_PREFIXES = ['data:', 'blob:', 'http://', 'https://'];

export function isCustomWallpaper(wallpaper: string | null | undefined): boolean {
  return Boolean(wallpaper && !BUILT_IN_WALLPAPERS.has(wallpaper));
}

/**
 * Background style for the chat body. Storage references must first be
 * resolved to a URL; until then only directly loadable URLs are painted.
 */
export function getChatBodyStyle(wallpaper: string | null | undefined, resolvedUrl: string | null | undefined): Record<string, string> {
  if (!wallpaper || !isCustomWallpaper(wallpaper)) return {};
  const isDirect = DIRECT_URL_PREFIXES.some(prefix => wallpaper.startsWith(prefix));
  const url = resolvedUrl || (isDirect ? wallpaper : null);
  return {
    backgroundImage: url ? `url("${url}")` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

// --------------------------------------------------------------------- typing

export function formatTypingText(typingUsers: string[]): string | null {
  if (typingUsers.length === 0) return null;
  return `${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'печатают' : 'печатает'}...`;
}

// --------------------------------------------------------------------- search

export function findMessageMatches<T extends MessageLike>(messages: T[] | null | undefined, query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !messages) return [];
  return messages.filter(message => Boolean(message.text) && String(message.text).toLowerCase().includes(needle));
}

/** Step through matches with wrap-around in both directions. */
export function cycleMatchIndex(current: number, total: number, step: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + step + total) % total;
}

/** Keep the selected match valid after the result list shrinks. */
export function clampMatchIndex(current: number, total: number): number {
  if (total === 0) return 0;
  return current >= total ? total - 1 : current;
}

/** Ctrl/Cmd+F, including the Russian layout key on the same position. */
export function isFindShortcut(event: { ctrlKey?: boolean; metaKey?: boolean; key?: string }): boolean {
  return Boolean((event.ctrlKey || event.metaKey) && ['f', 'F', 'а', 'А'].includes(event.key ?? ''));
}

// ------------------------------------------------------------ unread & dates

export function isOwnSender(senderId: string | null | undefined, currentUserId: string | null | undefined): boolean {
  return senderId === currentUserId || senderId === 'current';
}

function isUnreadIncoming(message: MessageLike, currentUserId: string | null | undefined): boolean {
  return !isOwnSender(message.senderId, currentUserId) && !message.read;
}

/** Unread total, preferring the server counter over local read flags. */
export function countUnreadMessages(chat: ChatLike | null | undefined, currentUserId: string | null | undefined): number {
  if (typeof chat?.unread_count === 'number') return chat.unread_count;
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  return messages.filter(message => isUnreadIncoming(message, currentUserId)).length;
}

/** Index of the row that gets the "unread messages" divider, or -1. */
export function getFirstUnreadIndex(messages: MessageLike[], unreadCount: number | undefined, currentUserId: string | null | undefined): number {
  if (typeof unreadCount === 'number' && unreadCount > 0) return messages.length - unreadCount;
  return messages.findIndex(message => isUnreadIncoming(message, currentUserId));
}

function dayKey(value: MessageLike['timestamp']): string {
  return new Date(value as string).toDateString();
}

export function needsDateDivider(previous: MessageLike | undefined, message: MessageLike): boolean {
  return !previous || dayKey(message.timestamp) !== dayKey(previous.timestamp);
}

export function formatDateDivider(timestamp: MessageLike['timestamp'], now: Date = new Date()): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

// ------------------------------------------------------------ outside clicks

/**
 * Message menus, the reaction drawer and the mobile action sheet are portaled
 * to document.body; clicks inside them must not count as "outside".
 */
export const MESSAGE_ACTION_SAFE_SELECTORS = [
  '.message-hover-actions',
  '.reaction-drawer',
  '.mobile-action-sheet',
  '.mobile-action-sheet-backdrop',
] as const;

export const RETRY_MENU_SAFE_SELECTORS = ['.failed-message-menu', '.seen-check.failed'] as const;

interface ClosestTarget { closest(selector: string): unknown }

function isInsideAny(target: ClosestTarget, selectors: readonly string[]): boolean {
  return selectors.some(selector => Boolean(target.closest(selector)));
}

export function shouldCloseMessageActions(target: ClosestTarget): boolean {
  return !isInsideAny(target, MESSAGE_ACTION_SAFE_SELECTORS);
}

export function shouldCloseRetryMenu(target: ClosestTarget): boolean {
  return !isInsideAny(target, RETRY_MENU_SAFE_SELECTORS);
}

// ------------------------------------------------------------------ recording

export type RecordMode = 'voice' | 'video';

/** Hold the record button this long before recording starts; a shorter tap toggles the mode. */
export const RECORD_HOLD_DELAY_MS = 250;
export const MAX_RECORDING_BYTES = 15 * 1024 * 1024;
const CANCEL_SWIPE_X_PX = 100;
const CANCEL_MAX_DRIFT_Y_PX = 40;
const LOCK_SWIPE_Y_PX = 80;
const UNLOCK_SWIPE_Y_PX = 30;

export function getRecordingConstraints(mode: RecordMode): MediaStreamConstraints {
  return mode === 'voice'
    ? { audio: true, video: false }
    : { audio: true, video: { width: { ideal: 320 }, height: { ideal: 320 }, facingMode: 'user' } };
}

export function toggleRecordMode(mode: RecordMode): RecordMode {
  return mode === 'voice' ? 'video' : 'voice';
}

export type RecordGesture =
  | { type: 'cancel' }
  | { type: 'lock-hint'; active: boolean }
  | { type: 'none' };

/**
 * Interpret pointer movement relative to where the hold started:
 * a mostly-horizontal swipe left cancels, a swipe up arms the lock.
 */
export function getRecordGesture({ diffX, diffY, isLockActive }: { diffX: number; diffY: number; isLockActive: boolean }): RecordGesture {
  if (diffX > CANCEL_SWIPE_X_PX && diffY < CANCEL_MAX_DRIFT_Y_PX) return { type: 'cancel' };
  if (diffY > LOCK_SWIPE_Y_PX) return { type: 'lock-hint', active: true };
  if (diffY < UNLOCK_SWIPE_Y_PX && isLockActive) return { type: 'lock-hint', active: false };
  return { type: 'none' };
}

export function formatRecordDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// -------------------------------------------------------------- media captions

/** Fallback text stored alongside an attached file. */
export function getAttachmentCaption(kind: string): string {
  if (kind === 'audio') return 'Голосовое сообщение';
  if (kind === 'video') return '🎬 [Видео]';
  return 'Изображение';
}

export function getRecordingCaption(mode: RecordMode): string {
  return mode === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение';
}

export function getRecordingMediaType(mode: RecordMode): 'audio' | 'video' {
  return mode === 'voice' ? 'audio' : 'video';
}

/** Clipboard items that can be sent as chat media. */
export function isPastableMediaType(type: string): boolean {
  return type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/');
}
