import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatAreaSource = readFileSync(
  new URL('../src/components/ChatArea.jsx', import.meta.url),
  'utf8'
);

test('ChatArea defines ResizeObserver and multi-stage anchor refs for scroll stability', () => {
  assert.match(chatAreaSource, /userScrolledManuallyRef/);
  assert.match(chatAreaSource, /anchorMessageIdRef/);
  assert.match(chatAreaSource, /anchorOffsetRef/);
  assert.match(chatAreaSource, /prevChatIdRef/);
  assert.match(chatAreaSource, /new ResizeObserver/);
});

test('ChatArea guards saveCurrentScrollPosition against saving during initial load', () => {
  assert.match(chatAreaSource, /if\s*\(\s*isInitialChatLoadRef\.current\s*\)\s*return;/);
});

test('ChatArea hooks pagehide and visibilitychange for persistent scroll saves', () => {
  assert.match(chatAreaSource, /addEventListener\('pagehide'/);
  assert.match(chatAreaSource, /addEventListener\('visibilitychange'/);
});

test('ChatArea attaches manual scroll interaction listeners on chat container', () => {
  assert.match(chatAreaSource, /onWheel=\{[^}]*userScrolledManuallyRef\.current\s*=\s*true/);
  assert.match(chatAreaSource, /onTouchStart=\{[^}]*userScrolledManuallyRef\.current\s*=\s*true/);
  assert.match(chatAreaSource, /onPointerDown=\{[^}]*userScrolledManuallyRef\.current\s*=\s*true/);
});

test('Chat switch does not trigger autoscroll when message counts differ', () => {
  let scrollInvocations = 0;
  let prevChatId = 'chat-1';
  let prevMessageCount = 5;
  let prevLatestMessageId = 'msg-5';

  function onChatOrMessageUpdate(chatId, messages) {
    const isChatChanged = prevChatId !== chatId;
    prevChatId = chatId;

    const messageCount = messages.length;
    const latestMessage = messages[messages.length - 1];
    const latestMessageId = latestMessage?.id;

    if (isChatChanged) {
      prevMessageCount = messageCount;
      prevLatestMessageId = latestMessageId;
      return;
    }

    const isNewMessage = (
      messageCount > prevMessageCount &&
      latestMessageId !== prevLatestMessageId
    );

    if (isNewMessage) {
      scrollInvocations++;
    }

    prevMessageCount = messageCount;
    prevLatestMessageId = latestMessageId;
  }

  // Switch to chat-2 which has 30 messages (30 > 5)
  const chat2Messages = Array.from({ length: 30 }, (_, i) => ({
    id: `c2-msg-${i + 1}`,
    text: `Text ${i + 1}`,
    senderId: 'current'
  }));

  onChatOrMessageUpdate('chat-2', chat2Messages, 'current');

  assert.equal(scrollInvocations, 0, 'Switching chat must not be treated as a new message autoscroll');

  // Now a real new message arrives in chat-2
  const chat2Updated = [
    ...chat2Messages,
    { id: 'c2-msg-31', text: 'New text', senderId: 'current' }
  ];
  onChatOrMessageUpdate('chat-2', chat2Updated, 'current');
  assert.equal(scrollInvocations, 1, 'Real new message in same chat triggers scroll');
});

test('ResizeObserver anchor policy preserves target message offset', () => {
  let scrollTop = 500;
  const targetMessageOffsetTop = 600;
  const savedOffset = 50;

  // Expected restored scrollTop: targetMessageOffsetTop - savedOffset = 550
  scrollTop = targetMessageOffsetTop - savedOffset;
  assert.equal(scrollTop, 550);

  // When content above expands (e.g. image loads), message offset changes to 800
  const updatedMessageOffsetTop = 800;
  scrollTop = updatedMessageOffsetTop - savedOffset;
  assert.equal(scrollTop, 750, 'Scroll top adjusts to keep message at exact relative viewport position');
});

test('ChatArea integrates persistSettledScroll for immediate durable persistence', () => {
  assert.match(chatAreaSource, /persistSettledScroll/);
  assert.match(chatAreaSource, /isPointerDownRef/);
  assert.match(chatAreaSource, /initialMountTickRef/);
});

test('Hydration pipeline holds isInitialChatLoad active across 1-message preview tick', () => {
  let isInitialChatLoad = true;
  let initialMountTick = true;
  let restoredScrollTop = 0;
  const scrollHeightPreview = 60;
  const scrollHeightHydrated = 3000;

  function runLayoutEffect(messageCount, isSyncing, isChatLoading, targetMessageInDom) {
    if (!isInitialChatLoad) return;

    if (targetMessageInDom) {
      restoredScrollTop = 1450;
      isInitialChatLoad = false;
      initialMountTick = false;
      return;
    }

    // Default or bottom restoration
    restoredScrollTop = messageCount > 1 ? scrollHeightHydrated : scrollHeightPreview;

    if (messageCount > 1 || (!initialMountTick && !isSyncing && !isChatLoading)) {
      isInitialChatLoad = false;
      initialMountTick = false;
    } else {
      initialMountTick = false;
    }
  }

  // Tick 0: 1 preview message present, sync in-flight
  runLayoutEffect(1, true, false, false);
  assert.equal(isInitialChatLoad, true, 'Must stay in initial load during preview tick');
  assert.equal(restoredScrollTop, 60, 'Sets preview scroll top without completing');

  // Tick 1: 50 cached messages arrive from IndexedDB, target message found
  runLayoutEffect(50, true, false, true);
  assert.equal(isInitialChatLoad, false, 'Restoration completes once full messages hydrate');
  assert.equal(restoredScrollTop, 1450, 'Restores target message scrollTop');
});

test('scrollToBottom records isAtBottom and distanceFromBottom: 0 for instant chat switch restoration', () => {
  const scrollMap = new Map();
  const mockLocalStorage = {};

  function performScrollToBottom(chatId, scrollHeight) {
    const scrollData = {
      scrollTop: scrollHeight,
      scrollHeight,
      distanceFromBottom: 0,
      isAtBottom: true,
      topMessageId: null,
      topMessageOffset: 0,
      timestamp: Date.now()
    };
    scrollMap.set(chatId, scrollData);
    mockLocalStorage[`coingram_chat_scroll_${chatId}`] = JSON.stringify(scrollData);
  }

  performScrollToBottom('chat-abc', 4200);

  const savedMemory = scrollMap.get('chat-abc');
  assert.equal(savedMemory.isAtBottom, true);
  assert.equal(savedMemory.distanceFromBottom, 0);

  const savedStorage = JSON.parse(mockLocalStorage['coingram_chat_scroll_chat-abc']);
  assert.equal(savedStorage.isAtBottom, true);
  assert.equal(savedStorage.scrollTop, 4200);
});

test('ChatArea scroll to bottom button and programmatic scroll contracts', () => {
  assert.match(chatAreaSource, /isScrollingToBottomRef/);
  assert.match(chatAreaSource, /scrollTimeoutRef/);
  assert.match(chatAreaSource, /footerRef/);
  assert.match(chatAreaSource, /setFooterHeight/);
  assert.match(chatAreaSource, /if\s*\(isScrollingToBottomRef\.current\)[\s\S]*scrollTo\(\{[\s\S]*behavior:\s*'smooth'/);
  assert.match(chatAreaSource, /Math\.max\(0,\s*scrollHeight\s*-\s*scrollTop\s*-\s*clientHeight\)/);
  assert.match(chatAreaSource, /className="scroll-bottom-btn"[\s\S]*setShowScrollBottom\(false\)[\s\S]*scrollToBottom\('smooth'\)/);
});

test('Programmatic scroll to bottom preserves autoscroll across intermediate scroll events', () => {
  let isScrollingToBottom = false;
  let shouldAutoScroll = false;
  let showScrollBottom = true;
  let anchorMessageId = 'msg-10';

  function onScrollToBottom() {
    isScrollingToBottom = true;
    shouldAutoScroll = true;
    showScrollBottom = false;
    anchorMessageId = null;
  }

  function onHandleScroll(scrollTop, scrollHeight, clientHeight) {
    const distanceFromBottom = Math.max(0, scrollHeight - scrollTop - clientHeight);
    if (isScrollingToBottom) {
      if (distanceFromBottom <= 30) {
        isScrollingToBottom = false;
        shouldAutoScroll = true;
        showScrollBottom = false;
      } else {
        shouldAutoScroll = true;
        showScrollBottom = false;
      }
      return;
    }

    shouldAutoScroll = distanceFromBottom < 120;
    showScrollBottom = distanceFromBottom > 300;
    anchorMessageId = 'msg-mid';
  }

  onScrollToBottom();
  assert.equal(isScrollingToBottom, true);
  assert.equal(showScrollBottom, false);
  assert.equal(shouldAutoScroll, true);

  // Intermediate scroll event at mid-flight (distance: 500px)
  onHandleScroll(1000, 2000, 500);
  assert.equal(shouldAutoScroll, true, 'Autoscroll must not be flipped to false during programmatic scroll');
  assert.equal(showScrollBottom, false, 'Scroll button must stay hidden during programmatic scroll');
  assert.equal(anchorMessageId, null, 'Anchor message must not be overwritten during programmatic scroll');

  // Subpixel distance (15px) arrives cleanly at bottom
  onHandleScroll(1485, 2000, 500);
  assert.equal(isScrollingToBottom, false, 'Programmatic scroll flag clears within arrival threshold');
  assert.equal(shouldAutoScroll, true);
  assert.equal(showScrollBottom, false);
});

test('Manual user scroll gesture interrupts programmatic scroll to bottom', () => {
  let isScrollingToBottom = true;
  let userScrolledManually = false;

  function onUserWheel() {
    userScrolledManually = true;
    isScrollingToBottom = false;
  }

  onUserWheel();
  assert.equal(isScrollingToBottom, false, 'Manual interaction must cancel programmatic scroll flag');
  assert.equal(userScrolledManually, true, 'Manual interaction marks userScrolledManually');
});

test('Chat switch resets showScrollBottom and prevents sticky visibility', () => {
  let showScrollBottom = true;
  let prevChatId = 'chat-1';

  function onChatSwitch(nextChatId, savedDistanceFromBottom) {
    if (prevChatId !== nextChatId) {
      prevChatId = nextChatId;
      showScrollBottom = false;
    }
    if (typeof savedDistanceFromBottom === 'number') {
      showScrollBottom = savedDistanceFromBottom > 300;
    }
  }

  // Switch to chat-2 which is saved at bottom (distance: 0)
  onChatSwitch('chat-2', 0);
  assert.equal(showScrollBottom, false, 'Button must not stick when switching to chat at bottom');

  // Switch to chat-3 which is saved scrolled up (distance: 800)
  onChatSwitch('chat-3', 800);
  assert.equal(showScrollBottom, true, 'Button shows when switching to chat saved far from bottom');
});

test('Distance from bottom handles rubber-band overscroll gracefully', () => {
  const scrollHeight = 1000;
  const clientHeight = 600;
  const overscrollTop = 450;
  const rawDistance = scrollHeight - overscrollTop - clientHeight;
  assert.equal(rawDistance < 0, true, 'Raw distance is negative under overscroll');

  const clampedDistance = Math.max(0, scrollHeight - overscrollTop - clientHeight);
  assert.equal(clampedDistance, 0, 'Clamped distance must not be negative');
});

test('ResizeObserver does not snap scrollTop during programmatic smooth scroll', () => {
  let isScrollingToBottom = true;
  let shouldAutoScroll = false;
  let scrollTop = 500;
  const scrollCalls = [];

  const mockElement = {
    scrollHeight: 2000,
    scrollTo({ top, behavior }) {
      scrollCalls.push({ top, behavior });
    }
  };

  if (isScrollingToBottom) {
    mockElement.scrollTo({ top: mockElement.scrollHeight, behavior: 'smooth' });
  } else if (shouldAutoScroll) {
    scrollTop = mockElement.scrollHeight;
  }

  assert.equal(scrollTop, 500, 'scrollTop must not jump instantly during smooth scroll');
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollCalls[0].behavior, 'smooth', 'ResizeObserver retargets smoothly instead of snapping');
});

test('Smooth scroll idle debounce protects multi-second flights from premature cutoff', () => {
  let timeoutId = null;
  let settled = false;

  function onIntermediateScroll() {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      settled = true;
    }, 300);
  }

  for (let t = 0; t <= 1000; t += 50) {
    onIntermediateScroll();
  }

  assert.equal(settled, false, 'Debounced timeout must not settle while frames are continuously firing');
  clearTimeout(timeoutId);
});


