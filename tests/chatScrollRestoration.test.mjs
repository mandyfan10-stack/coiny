import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AT_BOTTOM_TOLERANCE_PX,
  SCROLL_STORAGE_KEY_PREFIX,
  createBottomScrollSnapshot,
  createScrollSnapshot,
  findSavedScrollTarget,
  findTopVisibleRow,
  getClampedDistanceFromBottom,
  getDistanceFromBottom,
  getPaginationRestoreTop,
  getResizeAction,
  hasProgrammaticScrollArrived,
  readSavedChatScroll,
  resolveUserScrollPin,
  shouldLoadOlderMessages,
  shouldWaitForOlderHistory,
  writeSavedChatScroll,
} from '../src/components/chat/chatScrollPolicy.ts';

// Behaviour of the scroll policy used by useChatScroll. Browser-level
// integration (real layout, pagination, resize) lives in tests/scroll/.

/** Minimal chat body: rows stacked at `height` px each, viewport scrolled to `scrollTop`. */
function fakeChatBody(rows, { scrollTop = 0, height = 100, containerTop = 0 } = {}) {
  const elements = rows.map(({ id, timestamp }, index) => {
    const top = containerTop + index * height - scrollTop;
    return {
      dataset: { messageId: id, messageTimestamp: timestamp === undefined ? undefined : String(timestamp) },
      offsetTop: index * height,
      getAttribute: name => (name === 'data-message-id' ? id : null),
      getBoundingClientRect: () => ({ top, bottom: top + height }),
    };
  });
  return {
    querySelectorAll: () => elements,
    getBoundingClientRect: () => ({ top: containerTop, bottom: containerTop + 600 }),
    rows: elements,
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

test('distance from bottom is raw for thresholds and clamped under rubber-band overscroll', () => {
  const overscrolled = { scrollTop: 450, scrollHeight: 1000, clientHeight: 600 };
  assert.equal(getDistanceFromBottom(overscrolled), -50);
  assert.equal(getClampedDistanceFromBottom(overscrolled), 0);
  assert.equal(getClampedDistanceFromBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 600 }), 300);
});

test('saved positions round-trip through storage under the per-chat key', () => {
  const storage = memoryStorage();
  const snapshot = createBottomScrollSnapshot(4200, 1);
  writeSavedChatScroll('chat-abc', snapshot, storage);

  assert.ok(storage.map.has(`${SCROLL_STORAGE_KEY_PREFIX}chat-abc`));
  assert.deepEqual(readSavedChatScroll('chat-abc', storage), snapshot);
  assert.equal(readSavedChatScroll('chat-other', storage), null);
});

test('saved position storage tolerates missing ids, corrupt JSON and quota errors', () => {
  const storage = memoryStorage();
  storage.map.set(`${SCROLL_STORAGE_KEY_PREFIX}broken`, '{not json');
  assert.equal(readSavedChatScroll('broken', storage), null);
  assert.equal(readSavedChatScroll(null, storage), null);
  assert.equal(readSavedChatScroll('chat', null), null);

  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.doesNotThrow(() => writeSavedChatScroll('chat', createBottomScrollSnapshot(10), full));
});

test('scroll-to-bottom snapshot records the bottom so a chat switch restores instantly', () => {
  const snapshot = createBottomScrollSnapshot(4200, 99);
  assert.equal(snapshot.isAtBottom, true);
  assert.equal(snapshot.distanceFromBottom, 0);
  assert.equal(snapshot.scrollTop, 4200);
  assert.equal(snapshot.topMessageId, null);
});

test('the top visible row is the first one whose bottom edge passes the viewport top', () => {
  const body = fakeChatBody(
    [{ id: 'a', timestamp: 1 }, { id: 'b', timestamp: 2 }, { id: 'c' }],
    { scrollTop: 130 },
  );
  assert.deepEqual(findTopVisibleRow(body), { id: 'b', offset: -30, timestamp: 2 });

  // A row showing only its last few pixels does not count as visible.
  const sliver = fakeChatBody([{ id: 'a' }, { id: 'b' }], { scrollTop: 97 });
  assert.equal(findTopVisibleRow(sliver).id, 'b');
  assert.equal(findTopVisibleRow(sliver).timestamp, null, 'missing timestamps are reported as null');
  assert.equal(findTopVisibleRow(fakeChatBody([])), null);
});

test('a settled snapshot keeps the reading anchor and only claims "at bottom" when pinned there', () => {
  const topRow = { id: 'm7', offset: 12, timestamp: 70 };
  const reading = createScrollSnapshot({
    scrollTop: 100, scrollHeight: 2000, clientHeight: 500,
    shouldAutoScroll: false, userScrolledManually: true, topRow, now: 5,
  });
  assert.equal(reading.isAtBottom, false);
  assert.equal(reading.distanceFromBottom, 1400);
  assert.equal(reading.topMessageId, 'm7');
  assert.equal(reading.topMessageOffset, 12);
  assert.equal(reading.topMessageTimestamp, 70);

  const pinned = { scrollHeight: 2000, clientHeight: 500, shouldAutoScroll: true, topRow };
  assert.equal(createScrollSnapshot({ ...pinned, scrollTop: 1000, userScrolledManually: false }).isAtBottom, true,
    'a pinned reader with no manual scroll is at bottom regardless of transient distance');
  assert.equal(createScrollSnapshot({ ...pinned, scrollTop: 1500 - AT_BOTTOM_TOLERANCE_PX, userScrolledManually: true }).isAtBottom, true);
  assert.equal(createScrollSnapshot({ ...pinned, scrollTop: 1400, userScrolledManually: true }).isAtBottom, false,
    'a manual reader 100px up is not at bottom even while auto-scroll is still armed');
});

test('a saved anchor resolves to its exact row when rendered', () => {
  const body = fakeChatBody([{ id: 'a', timestamp: 10 }, { id: 'b', timestamp: 20 }]);
  const target = findSavedScrollTarget(body, { topMessageId: 'b', topMessageTimestamp: 20 });
  assert.equal(target.row, body.rows[1]);
  assert.equal(target.needsOlder, false);
});

test('a deleted saved message falls back to the adjacent row by timestamp', () => {
  const body = fakeChatBody([{ id: 'a', timestamp: 10 }, { id: 'c', timestamp: 30 }]);
  const target = findSavedScrollTarget(body, { topMessageId: 'b', topMessageTimestamp: 20 });
  assert.equal(target.row, body.rows[1]);
  assert.equal(target.needsOlder, false);
});

test('a saved anchor older than the loaded window asks for older history', () => {
  const body = fakeChatBody([{ id: 'x', timestamp: 500 }, { id: 'y', timestamp: 600 }]);
  const target = findSavedScrollTarget(body, { topMessageId: 'gone', topMessageTimestamp: 100 });
  assert.equal(target.needsOlder, true);
  assert.equal(target.row, body.rows[0], 'meanwhile the closest loaded row is offered');

  assert.deepEqual(findSavedScrollTarget(body, { topMessageId: 'gone' }), { row: null, needsOlder: true },
    'without a timestamp the only safe answer is to load more');
});

test('restoration waits for older history only while more can still arrive', () => {
  const base = { needsOlder: true, messageCount: 30, isSyncing: false, isChatLoading: false };
  assert.equal(shouldWaitForOlderHistory({ ...base, hasMore: true }), true);
  assert.equal(shouldWaitForOlderHistory({ ...base, hasMore: undefined }), true, 'unknown pagination may still have pages');
  assert.equal(shouldWaitForOlderHistory({ ...base, hasMore: false }), false, 'the start of history was reached');
  assert.equal(shouldWaitForOlderHistory({ ...base, hasMore: false, isSyncing: true }), true);
  assert.equal(shouldWaitForOlderHistory({ ...base, hasMore: false, messageCount: 1 }), true, 'a 1-message preview is not the full history');
  assert.equal(shouldWaitForOlderHistory({ ...base, needsOlder: false, hasMore: true }), false);
});

test('older pages load near the top but never during the initial restore or a pending request', () => {
  const base = { isInitialChatLoad: false, scrollTop: 40, hasMore: true, isLoadingOlder: false };
  assert.equal(shouldLoadOlderMessages(base), true);
  assert.equal(shouldLoadOlderMessages({ ...base, scrollTop: 81 }), false);
  assert.equal(shouldLoadOlderMessages({ ...base, hasMore: false }), false);
  assert.equal(shouldLoadOlderMessages({ ...base, isLoadingOlder: true }), false);
  assert.equal(shouldLoadOlderMessages({ ...base, scrollTop: 0, isInitialChatLoad: true }), false,
    'a long chat opens at scrollTop 0 before layout restores it');
});

test('prepending history keeps the reading anchor, compensates without one, or follows the pin', () => {
  const base = { scrollHeight: 2600, anchorOffset: 50, previousTop: 15, previousHeight: 1200 };
  assert.equal(getPaginationRestoreTop({ ...base, shouldAutoScroll: false, anchorOffsetTop: 1600 }), 1550);
  assert.equal(getPaginationRestoreTop({ ...base, shouldAutoScroll: false, anchorOffsetTop: null }), 15 + 1400,
    'without an anchor, push the viewport down by exactly the added height');
  assert.equal(getPaginationRestoreTop({ ...base, shouldAutoScroll: true, anchorOffsetTop: 1600 }), 2600);
});

test('resizes retarget an in-flight smooth scroll instead of snapping it', () => {
  const idle = { isInitialChatLoad: false, isLoadingOlder: false, isPointerDown: false, shouldAutoScroll: true, hasAnchor: false };
  assert.equal(getResizeAction({ ...idle, isScrollingToBottom: true }), 'retarget-smooth');
  assert.equal(getResizeAction({ ...idle, isScrollingToBottom: false }), 'pin-bottom');
});

test('resizes keep the anchor for a reader and never interfere with restore, paging or touch', () => {
  const reader = { isInitialChatLoad: false, isLoadingOlder: false, isPointerDown: false, isScrollingToBottom: false, shouldAutoScroll: false };
  assert.equal(getResizeAction({ ...reader, hasAnchor: true }), 'restore-anchor');
  assert.equal(getResizeAction({ ...reader, hasAnchor: false }), 'ignore');
  for (const busy of ['isInitialChatLoad', 'isLoadingOlder', 'isPointerDown']) {
    assert.equal(getResizeAction({ ...reader, hasAnchor: true, shouldAutoScroll: true, [busy]: true }), 'ignore', busy);
  }
});

test('a programmatic scroll counts as arrived within 30px of the bottom', () => {
  assert.equal(hasProgrammaticScrollArrived(15), true);
  assert.equal(hasProgrammaticScrollArrived(30), true);
  assert.equal(hasProgrammaticScrollArrived(500), false);
});

test('a small first upward scroll releases the pin and ends the initial restore', () => {
  const pin = resolveUserScrollPin({
    distanceFromBottom: 8, isScrollingUp: true, isScrollingDown: false,
    wasPinnedToBottom: false, userScrolledManually: true,
  });
  assert.equal(pin.shouldAutoScroll, false, 'even a few pixels up expresses reading intent');
  assert.equal(pin.endsInitialLoad, true);
  assert.equal(pin.clearsManualScroll, false);
});

test('scrolling back down to the bottom re-attaches the pin and hides the button', () => {
  const pin = resolveUserScrollPin({
    distanceFromBottom: 10, isScrollingUp: false, isScrollingDown: true,
    wasPinnedToBottom: false, userScrolledManually: true,
  });
  assert.deepEqual(pin, { shouldAutoScroll: true, showScrollBottom: false, endsInitialLoad: true, clearsManualScroll: true });
});

test('reading far up shows the scroll button; a pinned reader never sees it', () => {
  const far = { distanceFromBottom: 900, isScrollingUp: true, isScrollingDown: false, userScrolledManually: true };
  assert.equal(resolveUserScrollPin({ ...far, wasPinnedToBottom: false }).showScrollBottom, true);
  assert.equal(resolveUserScrollPin({ ...far, distanceFromBottom: 250, wasPinnedToBottom: false }).showScrollBottom, false);
  const pinned = resolveUserScrollPin({ ...far, isScrollingUp: false, userScrolledManually: false, wasPinnedToBottom: true });
  assert.equal(pinned.showScrollBottom, false);
  assert.equal(pinned.shouldAutoScroll, true, 'layout-driven scroll events cannot release an existing pin');
});

test('a reader within 120px of the bottom keeps following new messages', () => {
  const near = resolveUserScrollPin({
    distanceFromBottom: 100, isScrollingUp: false, isScrollingDown: false,
    wasPinnedToBottom: false, userScrolledManually: false,
  });
  assert.equal(near.shouldAutoScroll, true);
  const away = resolveUserScrollPin({
    distanceFromBottom: 130, isScrollingUp: false, isScrollingDown: false,
    wasPinnedToBottom: false, userScrolledManually: false,
  });
  assert.equal(away.shouldAutoScroll, false);
});
