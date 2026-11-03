import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  classifyMessageListUpdate,
  createBottomScrollSnapshot,
  createScrollSnapshot,
  findSavedScrollTarget,
  findTopVisibleRow,
  getClampedDistanceFromBottom,
  getDistanceFromBottom,
  getNewMessageScrollBehavior,
  getPaginationRestoreTop,
  getResizeAction,
  hasProgrammaticScrollArrived,
  isHydratingChatHistory,
  readSavedChatScroll,
  resolveUserScrollPin,
  shouldLoadOlderMessages,
  shouldShowScrollButton,
  shouldWaitForOlderHistory,
  writeSavedChatScroll,
} from './chatScrollPolicy.ts';
import { countUnreadMessages } from './chatAreaModel.ts';

const SMOOTH_SCROLL_FALLBACK_MS = 2000;
const SMOOTH_SCROLL_IDLE_MS = 300;

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Sandboxed frames throw SecurityError on access; positions stay in memory.
    return null;
  }
}

/**
 * Scroll ownership for the chat message window: bottom pin, per-chat reading
 * position (memory + localStorage), unread landing, history pagination and
 * layout-shift compensation. Decisions live in `chatScrollPolicy.ts`.
 */
export default function useChatScroll({
  activeChat,
  currentUserId,
  isInitialLoading,
  isChatLoading,
  isSyncing,
  messagePagination,
  loadOlderMessages,
}) {
  const activeChatId = activeChat?.id;
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const messagesEndRef = useRef(null);
  const chatBodyRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const isInitialChatLoadRef = useRef(true);
  const currentChatIdRef = useRef(activeChatId);
  const userScrolledManuallyRef = useRef(false);
  const isScrollingToBottomRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const anchorMessageIdRef = useRef(null);
  const anchorOffsetRef = useRef(0);
  const chatScrollPositionsRef = useRef(new Map());
  const paginationRequestRef = useRef(null);
  const [paginationRestoreRevision, setPaginationRestoreRevision] = useState(0);
  const historyRestoreRequestRef = useRef(null);
  const historyRestoreStoppedRef = useRef(false);
  const [historyRestoreRevision, setHistoryRestoreRevision] = useState(0);
  const isPointerDownRef = useRef(false);
  const initialMountTickRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const getSavedPosition = useCallback(chatId => (
    chatScrollPositionsRef.current.get(chatId) || readSavedChatScroll(chatId, browserStorage())
  ), []);

  const rememberPosition = useCallback((chatId, data) => {
    chatScrollPositionsRef.current.set(chatId, data);
    writeSavedChatScroll(chatId, data, browserStorage());
  }, []);

  const clearScrollTimeout = () => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  };

  const setAnchor = (row) => {
    anchorMessageIdRef.current = row?.id ?? null;
    anchorOffsetRef.current = row?.offset ?? 0;
  };

  const restoreReadingAnchor = useCallback((element) => {
    if (!anchorMessageIdRef.current) return;
    const anchor = element.querySelector(`.message-row[data-message-id="${anchorMessageIdRef.current}"]`);
    if (!anchor) return;
    // offsetTop rounds fractional row positions in WebKit. Restore by the
    // visible delta so repeated resizes cannot accumulate that rounding.
    const delta = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - anchorOffsetRef.current;
    if (Math.abs(delta) > 0.5) element.scrollTop += delta;
    lastScrollTopRef.current = element.scrollTop;
  }, []);

  useEffect(() => () => {
    paginationRequestRef.current = null;
    historyRestoreRequestRef.current = null;
  }, []);

  const persistSettledScroll = useCallback((targetChatId = activeChatId) => {
    const element = chatBodyRef.current;
    if (!element || !targetChatId) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    if (scrollHeight <= 0) return;
    rememberPosition(targetChatId, createScrollSnapshot({
      scrollTop,
      scrollHeight,
      clientHeight,
      shouldAutoScroll: shouldAutoScrollRef.current,
      userScrolledManually: userScrolledManuallyRef.current,
      topRow: findTopVisibleRow(element),
    }));
  }, [activeChatId, rememberPosition]);

  const saveCurrentScrollPosition = useCallback(() => {
    if (isInitialChatLoadRef.current) return;
    persistSettledScroll(activeChatId);
  }, [activeChatId, persistSettledScroll]);

  const attachChatBody = useCallback(element => {
    // Each chat owns its DOM node. Save the outgoing node before React removes
    // it, including a final movement whose scroll event has not fired yet.
    if (!element && chatBodyRef.current && !isInitialChatLoadRef.current) {
      persistSettledScroll(activeChatId);
    }
    chatBodyRef.current = element;
  }, [activeChatId, persistSettledScroll]);

  const settleAtBottom = useCallback(() => {
    if (isScrollingToBottomRef.current && chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      isScrollingToBottomRef.current = false;
      shouldAutoScrollRef.current = true;
      setShowScrollBottom(false);
      persistSettledScroll(activeChatId);
    }
  }, [activeChatId, persistSettledScroll]);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const element = chatBodyRef.current;
    if (!element) return;

    clearScrollTimeout();
    userScrolledManuallyRef.current = false;
    isPointerDownRef.current = false;
    shouldAutoScrollRef.current = true;
    setAnchor(null);
    setShowScrollBottom(false);

    if (behavior === 'auto') {
      isScrollingToBottomRef.current = false;
      element.scrollTop = element.scrollHeight;
    } else {
      isScrollingToBottomRef.current = true;
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
      } else if (messagesEndRef.current?.scrollIntoView) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        element.scrollTop = element.scrollHeight;
      }
      scrollTimeoutRef.current = setTimeout(settleAtBottom, SMOOTH_SCROLL_FALLBACK_MS);
    }

    if (activeChatId) rememberPosition(activeChatId, createBottomScrollSnapshot(element.scrollHeight));
  }, [activeChatId, rememberPosition, settleAtBottom]);

  /** Bring a message into view (search results) and stop following the bottom. */
  const scrollMessageIntoView = useCallback((messageId) => {
    if (!messageId || !chatBodyRef.current) return;
    const target = chatBodyRef.current.querySelector(`.message-row[data-message-id="${messageId}"]`);
    if (!target) return;
    userScrolledManuallyRef.current = true;
    shouldAutoScrollRef.current = false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    const handleSave = () => saveCurrentScrollPosition();
    const handlePointerRelease = () => { isPointerDownRef.current = false; };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handleSave();
    };
    window.addEventListener('beforeunload', handleSave);
    window.addEventListener('pagehide', handleSave);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleSave);
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('touchend', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    return () => {
      window.removeEventListener('beforeunload', handleSave);
      window.removeEventListener('pagehide', handleSave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleSave);
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('touchend', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [saveCurrentScrollPosition]);

  // Initial placement on chat open: saved reading anchor, unread divider, or bottom.
  useLayoutEffect(() => {
    if (currentChatIdRef.current !== activeChatId) {
      currentChatIdRef.current = activeChatId;
      paginationRequestRef.current = null;
      historyRestoreRequestRef.current = null;
      historyRestoreStoppedRef.current = false;
      isLoadingOlderRef.current = false;
      lastScrollTopRef.current = 0;
      isInitialChatLoadRef.current = true;
      userScrolledManuallyRef.current = false;
      isScrollingToBottomRef.current = false;
      setAnchor(null);
      initialMountTickRef.current = true;
      setShowScrollBottom(false);
    }

    if (isInitialLoading) return;
    const element = chatBodyRef.current;
    if (!element || !activeChatId) return;
    const messageCount = activeChat?.messages?.length || 0;
    if (messageCount === 0) return;
    const busy = Boolean(isSyncing?.[activeChatId] || isChatLoading?.[activeChatId]);

    if (!isInitialChatLoadRef.current) {
      // React updates can change rows before an earlier restoration's scroll
      // event is delivered. Restore synchronously so it cannot save a shifted
      // anchor between rapid reaction or history updates.
      if (!shouldAutoScrollRef.current && !isScrollingToBottomRef.current &&
        !isLoadingOlderRef.current && !isPointerDownRef.current && anchorMessageIdRef.current) {
        restoreReadingAnchor(element);
      }
      return;
    }
    if (userScrolledManuallyRef.current) {
      isInitialChatLoadRef.current = false;
      initialMountTickRef.current = false;
      return;
    }

    const saved = getSavedPosition(activeChatId);
    shouldAutoScrollRef.current = !saved || saved.isAtBottom;

    // Restore the place the user left before considering new unread messages.
    // The initial cache/server window can omit that message, so retain the
    // saved anchor while older pages are fetched instead of overwriting it.
    if (saved && !saved.isAtBottom && saved.topMessageId) {
      const target = findSavedScrollTarget(element, saved);
      if (shouldWaitForOlderHistory({
        needsOlder: target.needsOlder,
        messageCount,
        isSyncing: Boolean(isSyncing?.[activeChatId]),
        isChatLoading: Boolean(isChatLoading?.[activeChatId]),
        hasMore: messagePagination?.[activeChatId]?.hasMore,
      })) {
        if (typeof saved.scrollTop === 'number') element.scrollTop = saved.scrollTop;
        lastScrollTopRef.current = element.scrollTop;
        return;
      }

      const offset = typeof saved.topMessageOffset === 'number' ? saved.topMessageOffset : 0;
      element.scrollTop = target.row ? target.row.offsetTop - offset : saved.scrollTop || 0;
      lastScrollTopRef.current = element.scrollTop;
      anchorMessageIdRef.current = target.row?.dataset.messageId || null;
      anchorOffsetRef.current = offset;
      userScrolledManuallyRef.current = true;
      isInitialChatLoadRef.current = false;
      initialMountTickRef.current = false;
      persistSettledScroll(activeChatId);
      setShowScrollBottom(shouldShowScrollButton(getDistanceFromBottom(element)));
      return;
    }

    // With no saved reading anchor, start at the unread divider.
    const unreadSource = { unread_count: activeChat?.unread_count, messages: activeChat?.messages };
    if (countUnreadMessages(unreadSource, currentUserId) > 0) {
      const unreadEl = element.querySelector('.unread-messages-divider');
      if (unreadEl) {
        unreadEl.scrollIntoView({ block: 'center', behavior: 'auto' });
        shouldAutoScrollRef.current = false;
        setAnchor(findTopVisibleRow(element));
        isInitialChatLoadRef.current = false;
        initialMountTickRef.current = false;
        persistSettledScroll(activeChatId);
        setShowScrollBottom(shouldShowScrollButton(getClampedDistanceFromBottom(element)));
        return;
      }
      if (messageCount <= 1 || busy) return;
    }

    // Saved bottom, or default to bottom.
    element.scrollTop = element.scrollHeight;
    shouldAutoScrollRef.current = true;
    setAnchor(null);
    setShowScrollBottom(false);

    if (messageCount > 1 || (!initialMountTickRef.current && !busy)) {
      isInitialChatLoadRef.current = false;
      initialMountTickRef.current = false;
      persistSettledScroll(activeChatId);
    } else {
      initialMountTickRef.current = false;
    }
  }, [activeChatId, activeChat?.messages, activeChat?.unread_count, isInitialLoading, isChatLoading, isSyncing, messagePagination, historyRestoreRevision, currentUserId, persistSettledScroll, restoreReadingAnchor, getSavedPosition]);

  // Fetch older pages until a saved reading anchor that predates the loaded window is present.
  useEffect(() => {
    if (!activeChatId || !isInitialChatLoadRef.current || userScrolledManuallyRef.current ||
      historyRestoreRequestRef.current || historyRestoreStoppedRef.current ||
      isChatLoading?.[activeChatId] || isSyncing?.[activeChatId] ||
      messagePagination?.[activeChatId]?.loading ||
      activeChat.messages.length <= 1 || messagePagination?.[activeChatId]?.hasMore === false) return;
    const saved = getSavedPosition(activeChatId);
    if (!saved || saved.isAtBottom || !saved.topMessageId || !chatBodyRef.current ||
      !findSavedScrollTarget(chatBodyRef.current, saved).needsOlder) return;

    const request = { chatId: activeChatId };
    historyRestoreRequestRef.current = request;
    Promise.resolve().then(() => historyRestoreRequestRef.current === request
      ? loadOlderMessages(request.chatId) : 0).then(loaded => {
      if (historyRestoreRequestRef.current !== request) return;
      // A failed/offline page must not erase the original saved position or
      // retry indefinitely. A new visit can try again; manual scrolling wins.
      if (!loaded) historyRestoreStoppedRef.current = true;
    }).catch(() => {
      if (historyRestoreRequestRef.current === request) historyRestoreStoppedRef.current = true;
    }).finally(() => {
      if (historyRestoreRequestRef.current !== request) return;
      historyRestoreRequestRef.current = null;
      setHistoryRestoreRevision(revision => revision + 1);
    });
  }, [activeChatId, activeChat?.messages, isChatLoading, isSyncing, messagePagination, loadOlderMessages, historyRestoreRevision, getSavedPosition]);

  // Keep the viewport stable after a user-triggered page of older history is prepended.
  useLayoutEffect(() => {
    const request = paginationRequestRef.current;
    if (!request?.restorationPending || currentChatIdRef.current !== request.chatId ||
      chatBodyRef.current !== request.element) return;
    // The state update and this layout effect commit together. An animation
    // frame after the promise can run before React has inserted the new rows.
    const { element, previousTop, previousHeight, readingAnchorId, readingAnchorOffset } = request;
    const readingAnchor = readingAnchorId
      ? [...element.querySelectorAll('.message-row')].find(row => row.dataset.messageId === readingAnchorId)
      : null;
    element.scrollTop = getPaginationRestoreTop({
      shouldAutoScroll: shouldAutoScrollRef.current,
      scrollHeight: element.scrollHeight,
      anchorOffsetTop: readingAnchor ? readingAnchor.offsetTop : null,
      anchorOffset: readingAnchorOffset,
      previousTop,
      previousHeight,
    });
    if (!shouldAutoScrollRef.current && readingAnchor) {
      anchorMessageIdRef.current = readingAnchorId;
      anchorOffsetRef.current = readingAnchorOffset;
    }
    lastScrollTopRef.current = element.scrollTop;
    persistSettledScroll(request.chatId);
    paginationRequestRef.current = null;
    isLoadingOlderRef.current = false;
  }, [activeChat?.messages, paginationRestoreRevision, persistSettledScroll]);

  // Compensate layout shifts (images decoding, composer growth).
  useEffect(() => {
    const element = chatBodyRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    // Loading replaces the list with a skeleton, so observe its new node when
    // cached or server messages arrive instead of retaining a detached list.
    const listElement = element.querySelector('.messages-list') || element;

    const observer = new ResizeObserver(() => {
      const body = chatBodyRef.current;
      if (!body) return;
      const action = getResizeAction({
        isInitialChatLoad: isInitialChatLoadRef.current,
        isLoadingOlder: isLoadingOlderRef.current,
        isPointerDown: isPointerDownRef.current,
        isScrollingToBottom: isScrollingToBottomRef.current,
        shouldAutoScroll: shouldAutoScrollRef.current,
        hasAnchor: Boolean(anchorMessageIdRef.current),
      });
      if (action === 'retarget-smooth') {
        if (typeof body.scrollTo === 'function') body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
      } else if (action === 'pin-bottom') {
        body.scrollTop = body.scrollHeight;
        lastScrollTopRef.current = body.scrollTop;
      } else if (action === 'restore-anchor') {
        restoreReadingAnchor(body);
      }
    });

    observer.observe(listElement);
    if (listElement !== element) observer.observe(element);
    return () => observer.disconnect();
  }, [activeChatId, isInitialLoading, restoreReadingAnchor]);

  // Follow new messages: own sends always, incoming ones only while pinned.
  const messages = activeChat?.messages;
  const latestMessage = messages?.[messages.length - 1];
  const latestMessageId = latestMessage?.id;
  const latestMessageSenderId = latestMessage?.senderId;
  const messageCount = messages?.length || 0;
  const prevMessageCountRef = useRef(messageCount);
  const prevLatestMessageIdRef = useRef(latestMessageId);
  const prevChatIdRef = useRef(activeChatId);

  useEffect(() => {
    const isChatChanged = prevChatIdRef.current !== activeChatId;
    prevChatIdRef.current = activeChatId;

    if (!isChatChanged) {
      const { isNewMessage, isOwnMessage } = classifyMessageListUpdate({
        previousCount: prevMessageCountRef.current,
        previousLatestId: prevLatestMessageIdRef.current,
        count: messageCount,
        latestId: latestMessageId,
        latestSenderId: latestMessageSenderId,
        currentUserId,
      });
      const behavior = getNewMessageScrollBehavior({
        isNewMessage,
        isOwnMessage,
        isHydrating: isHydratingChatHistory({
          isInitialChatLoad: isInitialChatLoadRef.current,
          isChatLoading: Boolean(isChatLoading?.[activeChatId]),
          previousCount: prevMessageCountRef.current,
          count: messageCount,
        }),
        isLoadingOlder: isLoadingOlderRef.current,
        shouldAutoScroll: shouldAutoScrollRef.current,
      });
      if (behavior) scrollToBottom(behavior);
    }

    prevMessageCountRef.current = messageCount;
    prevLatestMessageIdRef.current = latestMessageId;
  }, [activeChatId, latestMessageId, latestMessageSenderId, messageCount, currentUserId, scrollToBottom, isChatLoading]);

  // Monitor the reading position and page backwards near the top.
  const handleScroll = async () => {
    const element = chatBodyRef.current;
    if (!element) return;
    const { scrollTop, scrollHeight } = element;
    const pendingPage = paginationRequestRef.current;
    if (isLoadingOlderRef.current && pendingPage?.element === element &&
      element.querySelector('.message-row')?.dataset.messageId !== pendingPage.firstMessageId) return;
    const distanceFromBottom = getDistanceFromBottom(element);
    const effectiveDistance = Math.max(0, distanceFromBottom);
    const wasPinnedToBottom = shouldAutoScrollRef.current && !userScrolledManuallyRef.current && !isPointerDownRef.current;
    const isScrollingUp = scrollTop < (lastScrollTopRef.current || 0);
    const isScrollingDown = scrollTop > (lastScrollTopRef.current || 0);
    lastScrollTopRef.current = scrollTop;

    // Scrolling up during a programmatic scroll hands control back to the reader.
    if (isScrollingUp && isScrollingToBottomRef.current) {
      isScrollingToBottomRef.current = false;
      clearScrollTimeout();
      userScrolledManuallyRef.current = true;
      shouldAutoScrollRef.current = false;
      if (typeof element.scrollTo === 'function') element.scrollTo({ top: element.scrollTop, behavior: 'auto' });
    }

    if (isScrollingToBottomRef.current) {
      shouldAutoScrollRef.current = true;
      setShowScrollBottom(false);
      if (hasProgrammaticScrollArrived(effectiveDistance)) {
        isScrollingToBottomRef.current = false;
        clearScrollTimeout();
        persistSettledScroll(activeChatId);
      } else {
        // Debounce: long smooth flights emit many frames; settle once they stop.
        clearScrollTimeout();
        scrollTimeoutRef.current = setTimeout(settleAtBottom, SMOOTH_SCROLL_IDLE_MS);
      }
      return;
    }

    const pin = resolveUserScrollPin({
      distanceFromBottom,
      isScrollingUp,
      isScrollingDown,
      wasPinnedToBottom,
      userScrolledManually: userScrolledManuallyRef.current,
    });
    shouldAutoScrollRef.current = pin.shouldAutoScroll;
    setShowScrollBottom(pin.showScrollBottom);
    if (pin.endsInitialLoad) isInitialChatLoadRef.current = false;
    if (pin.clearsManualScroll) userScrolledManuallyRef.current = false;

    if (!isInitialChatLoadRef.current) {
      setAnchor(findTopVisibleRow(element));
      saveCurrentScrollPosition();
    }

    if (!shouldLoadOlderMessages({
      isInitialChatLoad: isInitialChatLoadRef.current,
      scrollTop,
      hasMore: messagePagination?.[activeChatId]?.hasMore,
      isLoadingOlder: isLoadingOlderRef.current,
    })) return;

    isLoadingOlderRef.current = true;
    const request = {
      chatId: activeChatId, element, previousHeight: scrollHeight, previousTop: scrollTop,
      firstMessageId: element.querySelector('.message-row')?.dataset.messageId,
    };
    paginationRequestRef.current = request;
    let restorationScheduled = false;
    try {
      const loaded = await loadOlderMessages(activeChatId);
      if (loaded > 0 && paginationRequestRef.current === request) {
        request.readingAnchorId = anchorMessageIdRef.current;
        request.readingAnchorOffset = anchorOffsetRef.current;
        request.restorationPending = true;
        restorationScheduled = true;
        setPaginationRestoreRevision(revision => revision + 1);
      }
    } finally {
      if (!restorationScheduled && paginationRequestRef.current === request) {
        paginationRequestRef.current = null;
        isLoadingOlderRef.current = false;
      }
    }
  };

  /** Any direct user gesture on the list takes over from programmatic scrolling. */
  const takeOverScroll = (element) => {
    userScrolledManuallyRef.current = true;
    lastScrollTopRef.current = element?.scrollTop || 0;
    isScrollingToBottomRef.current = false;
  };

  const stopSmoothScroll = () => {
    const body = chatBodyRef.current;
    if (typeof body?.scrollTo === 'function') body.scrollTo({ top: body.scrollTop, behavior: 'auto' });
  };

  const beginPointerGesture = () => {
    takeOverScroll(chatBodyRef.current);
    stopSmoothScroll();
    clearScrollTimeout();
    isPointerDownRef.current = true;
  };

  const endPointerGesture = () => { isPointerDownRef.current = false; };

  const bodyHandlers = {
    onScroll: handleScroll,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
      takeOverScroll(event.currentTarget);
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
        shouldAutoScrollRef.current = false;
      }
      clearScrollTimeout();
    },
    onWheel: (event) => {
      takeOverScroll(event.currentTarget);
      if (event.deltaY < 0) {
        shouldAutoScrollRef.current = false;
        stopSmoothScroll();
      }
      clearScrollTimeout();
    },
    onTouchStart: beginPointerGesture,
    onTouchEnd: endPointerGesture,
    onPointerDown: beginPointerGesture,
    onPointerUp: endPointerGesture,
    onPointerCancel: endPointerGesture,
  };

  const jumpToBottom = () => {
    shouldAutoScrollRef.current = true;
    setShowScrollBottom(false);
    scrollToBottom('smooth');
  };

  return {
    attachChatBody,
    bodyHandlers,
    jumpToBottom,
    messagesEndRef,
    scrollMessageIntoView,
    showScrollBottom,
  };
}
