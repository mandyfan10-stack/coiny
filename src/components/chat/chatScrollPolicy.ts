/**
 * Pure scroll-position policy for the chat message window.
 *
 * `useChatScroll` owns the refs, DOM writes and timers; every decision about
 * *where* to scroll or *whether* to keep the bottom pin lives here so it can
 * be unit-tested without a browser.
 */

export const SCROLL_STORAGE_KEY_PREFIX = 'coingram_chat_scroll_';
/** Scrolling back within this distance re-attaches the bottom pin. */
export const AUTO_SCROLL_THRESHOLD_PX = 120;
/** The "scroll to bottom" button appears beyond this distance. */
export const SCROLL_BUTTON_THRESHOLD_PX = 300;
/** A user at (or within) this distance from the bottom counts as "at bottom". */
export const AT_BOTTOM_TOLERANCE_PX = 15;
/** A programmatic smooth scroll counts as arrived within this distance. */
export const PROGRAMMATIC_ARRIVAL_PX = 30;
/** Older history is requested once the reader is this close to the top. */
export const PAGINATION_TRIGGER_PX = 80;
/** A row counts as visible once its bottom edge passes this far below the top. */
export const TOP_ROW_VISIBILITY_PX = 5;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface SavedChatScroll {
  scrollTop: number;
  scrollHeight: number;
  distanceFromBottom: number;
  isAtBottom: boolean;
  topMessageId: string | null;
  topMessageOffset: number;
  topMessageTimestamp?: number | null;
  timestamp: number;
}

export interface ScrollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RowRect { top: number; bottom: number }

/** The subset of a `.message-row` element the policy reads. */
export interface MessageRowLike {
  dataset: { messageId?: string; messageTimestamp?: string };
  offsetTop?: number;
  getAttribute?(name: string): string | null;
  getBoundingClientRect?(): RowRect;
}

/** The subset of the chat body element the policy reads. */
export interface ChatBodyLike {
  querySelectorAll(selector: string): Iterable<MessageRowLike> | ArrayLike<MessageRowLike>;
  getBoundingClientRect(): RowRect;
}

const MESSAGE_ROW_SELECTOR = '.message-row[data-message-id]';

/** Raw distance; negative during rubber-band overscroll. */
export function getDistanceFromBottom({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): number {
  return scrollHeight - scrollTop - clientHeight;
}

/** Distance clamped at zero so overscroll never reads as "below the bottom". */
export function getClampedDistanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(0, getDistanceFromBottom(metrics));
}

export function shouldShowScrollButton(distanceFromBottom: number): boolean {
  return distanceFromBottom > SCROLL_BUTTON_THRESHOLD_PX;
}

function storageKey(chatId: string): string {
  return `${SCROLL_STORAGE_KEY_PREFIX}${chatId}`;
}

export function readSavedChatScroll(chatId: string | null | undefined, storage: ScrollStorage | null | undefined): SavedChatScroll | null {
  if (!chatId || !storage) return null;
  try {
    const raw = storage.getItem(storageKey(chatId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSavedChatScroll(chatId: string | null | undefined, data: SavedChatScroll, storage: ScrollStorage | null | undefined): void {
  if (!chatId || !storage) return;
  try {
    storage.setItem(storageKey(chatId), JSON.stringify(data));
  } catch {
    // Quota or private-mode failures only lose the remembered position.
  }
}

function rowsOf(element: ChatBodyLike): MessageRowLike[] {
  return Array.from(element.querySelectorAll(MESSAGE_ROW_SELECTOR) as ArrayLike<MessageRowLike>);
}

export interface TopVisibleRow {
  id: string | null;
  offset: number;
  timestamp: number | null;
}

/** First message row whose bottom edge is inside the viewport, with its offset from the top. */
export function findTopVisibleRow(element: ChatBodyLike): TopVisibleRow | null {
  const containerTop = element.getBoundingClientRect().top;
  for (const row of rowsOf(element)) {
    const rect = row.getBoundingClientRect?.();
    if (!rect || rect.bottom <= containerTop + TOP_ROW_VISIBILITY_PX) continue;
    const timestamp = Number(row.dataset.messageTimestamp);
    return {
      id: row.getAttribute?.('data-message-id') ?? row.dataset.messageId ?? null,
      offset: rect.top - containerTop,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
    };
  }
  return null;
}

export interface SavedScrollTarget {
  row: MessageRowLike | null;
  /** The saved message predates the loaded window, so older pages are needed. */
  needsOlder: boolean;
}

/**
 * Locate the row a saved position refers to. When the exact message is not
 * rendered, fall back to the first row at or after its timestamp.
 */
export function findSavedScrollTarget(element: ChatBodyLike, saved: Pick<SavedChatScroll, 'topMessageId' | 'topMessageTimestamp'>): SavedScrollTarget {
  const rows = rowsOf(element);
  const exact = rows.find(row => row.dataset.messageId === saved.topMessageId);
  if (exact) return { row: exact, needsOlder: false };
  const timestamp = saved.topMessageTimestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return { row: null, needsOlder: true };
  const closest = rows.find(row => Number(row.dataset.messageTimestamp) >= timestamp) || rows.at(-1) || null;
  const oldest = Number(rows[0]?.dataset.messageTimestamp);
  return { row: closest, needsOlder: !Number.isFinite(oldest) || oldest > timestamp };
}

export interface ScrollSnapshotInput extends ScrollMetrics {
  shouldAutoScroll: boolean;
  userScrolledManually: boolean;
  topRow: TopVisibleRow | null;
  now?: number;
}

/** Position persisted when the reader settles. */
export function createScrollSnapshot(input: ScrollSnapshotInput): SavedChatScroll {
  const distanceFromBottom = getClampedDistanceFromBottom(input);
  return {
    scrollTop: input.scrollTop,
    scrollHeight: input.scrollHeight,
    distanceFromBottom,
    isAtBottom: input.shouldAutoScroll && (!input.userScrolledManually || distanceFromBottom <= AT_BOTTOM_TOLERANCE_PX),
    topMessageId: input.topRow?.id ?? null,
    topMessageOffset: input.topRow?.offset ?? 0,
    topMessageTimestamp: input.topRow?.timestamp ?? null,
    timestamp: input.now ?? Date.now(),
  };
}

/** Position persisted immediately when a scroll-to-bottom starts. */
export function createBottomScrollSnapshot(scrollHeight: number, now: number = Date.now()): SavedChatScroll {
  return {
    scrollTop: scrollHeight,
    scrollHeight,
    distanceFromBottom: 0,
    isAtBottom: true,
    topMessageId: null,
    topMessageOffset: 0,
    timestamp: now,
  };
}

export interface MessageListUpdate {
  previousCount: number;
  previousLatestId: string | null | undefined;
  count: number;
  latestId: string | null | undefined;
  latestSenderId: string | null | undefined;
  currentUserId: string | null | undefined;
}

/**
 * A message is "new" only when the list grew *and* its tail changed. Edits,
 * reactions and deletions keep the tail or shrink the list, so they never
 * move the reader.
 */
export function classifyMessageListUpdate(update: MessageListUpdate): { isNewMessage: boolean; isOwnMessage: boolean } {
  const isNewMessage = update.count > update.previousCount && update.latestId !== update.previousLatestId;
  const isOwnMessage = isNewMessage && (
    update.latestSenderId === update.currentUserId || update.latestSenderId === 'current'
  );
  return { isNewMessage, isOwnMessage };
}

/** Initial cache/server hydration must not be mistaken for a live arrival. */
export function isHydratingChatHistory({ isInitialChatLoad, isChatLoading, previousCount, count }: {
  isInitialChatLoad: boolean;
  isChatLoading: boolean;
  previousCount: number;
  count: number;
}): boolean {
  return Boolean(isInitialChatLoad || isChatLoading || (previousCount <= 1 && count > 1));
}

export type ScrollBehaviorChoice = 'auto' | 'smooth';

/**
 * How a new message should move the view, or `null` to leave it alone.
 * Own sends jump instantly so a smooth scroll cannot be interrupted while the
 * row is still off-screen; incoming messages only follow a pinned reader.
 */
export function getNewMessageScrollBehavior({ isNewMessage, isOwnMessage, isHydrating, isLoadingOlder, shouldAutoScroll }: {
  isNewMessage: boolean;
  isOwnMessage: boolean;
  isHydrating: boolean;
  isLoadingOlder: boolean;
  shouldAutoScroll: boolean;
}): ScrollBehaviorChoice | null {
  if (isLoadingOlder || isHydrating || !isNewMessage) return null;
  if (!shouldAutoScroll && !isOwnMessage) return null;
  return isOwnMessage ? 'auto' : 'smooth';
}

export type ResizeAction = 'ignore' | 'retarget-smooth' | 'pin-bottom' | 'restore-anchor';

/** What to do when the message list or composer changes size. */
export function getResizeAction({ isInitialChatLoad, isLoadingOlder, isPointerDown, isScrollingToBottom, shouldAutoScroll, hasAnchor }: {
  isInitialChatLoad: boolean;
  isLoadingOlder: boolean;
  isPointerDown: boolean;
  isScrollingToBottom: boolean;
  shouldAutoScroll: boolean;
  hasAnchor: boolean;
}): ResizeAction {
  if (isInitialChatLoad || isLoadingOlder || isPointerDown) return 'ignore';
  // Snapping mid-flight would cut a smooth scroll short; retarget it instead.
  if (isScrollingToBottom) return 'retarget-smooth';
  // The distance after a resize no longer describes the reader's intent.
  if (shouldAutoScroll) return 'pin-bottom';
  return hasAnchor ? 'restore-anchor' : 'ignore';
}

export interface UserScrollPinInput {
  /** Raw (unclamped) distance from the bottom. */
  distanceFromBottom: number;
  isScrollingUp: boolean;
  isScrollingDown: boolean;
  /** Pin state captured before this event was processed. */
  wasPinnedToBottom: boolean;
  userScrolledManually: boolean;
}

export interface UserScrollPin {
  shouldAutoScroll: boolean;
  showScrollBottom: boolean;
  /** The reader has taken over; the initial restore phase is over. */
  endsInitialLoad: boolean;
  /** The reader returned to the bottom; forget the manual-scroll flag. */
  clearsManualScroll: boolean;
}

/**
 * Bottom-pin state after a user-driven scroll event. Browser anchoring can
 * emit scroll events while images decode, so only real user input may
 * release an existing pin.
 */
export function resolveUserScrollPin(input: UserScrollPinInput): UserScrollPin {
  const { distanceFromBottom, isScrollingUp, isScrollingDown, wasPinnedToBottom, userScrolledManually } = input;
  const effectiveDistance = Math.max(0, distanceFromBottom);
  let shouldAutoScroll = wasPinnedToBottom || distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX;
  let showScrollBottom = !wasPinnedToBottom && shouldShowScrollButton(distanceFromBottom);
  let endsInitialLoad = false;
  let clearsManualScroll = false;

  if (userScrolledManually || (isScrollingUp && !wasPinnedToBottom)) {
    endsInitialLoad = true;
    // Repeated events may have zero delta mid-gesture; keep reading intent
    // even when the first frame is only a few pixels up.
    if (isScrollingUp || effectiveDistance > 0) shouldAutoScroll = false;
  }

  if (effectiveDistance <= AT_BOTTOM_TOLERANCE_PX && !isScrollingUp && (isScrollingDown || !userScrolledManually)) {
    clearsManualScroll = true;
    shouldAutoScroll = true;
    showScrollBottom = false;
  }

  return { shouldAutoScroll, showScrollBottom, endsInitialLoad, clearsManualScroll };
}

/** Whether a programmatic smooth scroll has effectively reached the bottom. */
export function hasProgrammaticScrollArrived(clampedDistanceFromBottom: number): boolean {
  return clampedDistanceFromBottom <= PROGRAMMATIC_ARRIVAL_PX;
}

export function shouldLoadOlderMessages({ isInitialChatLoad, scrollTop, hasMore, isLoadingOlder }: {
  isInitialChatLoad: boolean;
  scrollTop: number;
  hasMore: boolean | undefined;
  isLoadingOlder: boolean;
}): boolean {
  // A long chat opens at scrollTop 0 until layout restores the bottom/anchor;
  // paging then would strand the view in old history.
  if (isInitialChatLoad) return false;
  return scrollTop <= PAGINATION_TRIGGER_PX && hasMore !== false && !isLoadingOlder;
}

/**
 * scrollTop after older history was prepended: follow the bottom pin, keep
 * the reading anchor at its offset, or compensate by the added height.
 */
export function getPaginationRestoreTop({ shouldAutoScroll, scrollHeight, anchorOffsetTop, anchorOffset, previousTop, previousHeight }: {
  shouldAutoScroll: boolean;
  scrollHeight: number;
  anchorOffsetTop: number | null;
  anchorOffset: number;
  previousTop: number;
  previousHeight: number;
}): number {
  if (shouldAutoScroll) return scrollHeight;
  if (anchorOffsetTop !== null) return anchorOffsetTop - anchorOffset;
  return previousTop + scrollHeight - previousHeight;
}

/**
 * While a saved anchor is older than the loaded window, wait for more history
 * instead of settling on a wrong position.
 */
export function shouldWaitForOlderHistory({ needsOlder, messageCount, isSyncing, isChatLoading, hasMore }: {
  needsOlder: boolean;
  messageCount: number;
  isSyncing: boolean;
  isChatLoading: boolean;
  hasMore: boolean | undefined;
}): boolean {
  return needsOlder && (messageCount <= 1 || isSyncing || isChatLoading || hasMore !== false);
}
