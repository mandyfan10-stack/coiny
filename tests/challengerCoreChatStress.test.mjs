import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFiniteMediaDuration } from '../src/utils/mediaDuration.js';
import { SENDER_COLOR_COUNT, getMessageGrouping, getSenderColor } from '../src/utils/messageGrouping.ts';
import {
  classifyMessageListUpdate,
  getNewMessageScrollBehavior,
  getPaginationRestoreTop,
  isHydratingChatHistory,
} from '../src/components/chat/chatScrollPolicy.ts';

// ============================================================================
// 1. VOICE NOTE PROBING & WEBM INFINITY EDGE CASES
// ============================================================================

class MockDetachedAudio {
  constructor(initialDuration = Infinity, initialCurrentTime = 0) {
    this.duration = initialDuration;
    this.currentTime = initialCurrentTime;
    this.src = '';
    this.preload = '';
    this.listeners = new Map();
    this.seekCount = 0;
  }

  addEventListener(event, listener) {
    const arr = this.listeners.get(event) || [];
    arr.push(listener);
    this.listeners.set(event, arr);
  }

  removeEventListener(event, listener) {
    const arr = this.listeners.get(event) || [];
    this.listeners.set(event, arr.filter(l => l !== listener));
  }

  emit(event) {
    const arr = [...(this.listeners.get(event) || [])];
    for (const l of arr) l();
  }

  set seekTime(val) {
    this.currentTime = val;
    this.seekCount++;
  }
}

test('ADVERSARIAL: WebM Infinity duration probing with rapid duration updates', () => {
  const probe = new MockDetachedAudio(Infinity);
  let resolvedDuration = null;
  let seekedTriggered = false;

  const handleProbeCompute = () => {
    if (probe && probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
      resolvedDuration = probe.duration;
      probe.src = '';
    } else if (probe && probe.duration === Infinity) {
      const onSeeked = () => {
        if (probe) {
          seekedTriggered = true;
          probe.removeEventListener('seeked', onSeeked);
          if (probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
            resolvedDuration = probe.duration;
          }
          probe.src = '';
        }
      };
      probe.addEventListener('seeked', onSeeked);
      probe.currentTime = 1e101;
    }
  };

  probe.addEventListener('loadedmetadata', handleProbeCompute);
  probe.addEventListener('durationchange', handleProbeCompute);

  // 1. Initial metadata loaded with Infinity
  probe.emit('loadedmetadata');
  assert.equal(probe.currentTime, 1e101, 'Must seek to 1e101 to force WebM index load');
  assert.equal(resolvedDuration, null, 'Must not resolve while still Infinity');

  // 2. Multiple spurious durationchange events with NaN or Infinity before seeked
  probe.duration = NaN;
  probe.emit('durationchange');
  assert.equal(resolvedDuration, null, 'Must ignore NaN duration');

  probe.duration = Infinity;
  probe.emit('durationchange');
  assert.equal(resolvedDuration, null, 'Must ignore recurring Infinity duration');

  // 3. Browser finally resolves finite duration on seeked
  probe.duration = 37.45;
  probe.emit('seeked');

  assert.equal(seekedTriggered, true, 'seeked listener must fire');
  assert.equal(resolvedDuration, 37.45, 'Must resolve accurate finite duration on seeked');
  assert.equal(probe.src, '', 'Probe src must be reset to release audio buffer');
});

test('ADVERSARIAL: Detached probe cleanup during pending seek prevents memory leaks and dangling callbacks', () => {
  let probe = new MockDetachedAudio(Infinity);
  let resolvedDuration = null;
  let activeSeekListener = null;

  const handleProbeCompute = () => {
    if (probe && probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
      resolvedDuration = probe.duration;
      probe.src = '';
    } else if (probe && probe.duration === Infinity) {
      activeSeekListener = () => {
        if (probe) {
          probe.removeEventListener('seeked', activeSeekListener);
          if (probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
            resolvedDuration = probe.duration;
          }
          probe.src = '';
        }
      };
      probe.addEventListener('seeked', activeSeekListener);
      probe.currentTime = 1e101;
    }
  };

  probe.addEventListener('loadedmetadata', handleProbeCompute);
  probe.addEventListener('durationchange', handleProbeCompute);

  probe.emit('loadedmetadata');
  assert.equal(probe.currentTime, 1e101);

  // Simulate component unmount cleanup BEFORE seeked fires
  const unmountCleanup = () => {
    if (probe) {
      probe.removeEventListener('loadedmetadata', handleProbeCompute);
      probe.removeEventListener('durationchange', handleProbeCompute);
      probe.src = '';
      probe = null;
    }
  };

  unmountCleanup();
  assert.equal(probe, null, 'Probe must be nulled on unmount');

  // If a lingering seeked event occurs afterwards in the browser, it must not throw
  assert.doesNotThrow(() => {
    if (activeSeekListener) activeSeekListener();
  }, 'Post-unmount seeked event must be safe and idempotent');
  assert.equal(resolvedDuration, null, 'Unmounted probe should not record duration');
});

test('ADVERSARIAL: 50 concurrent detached probes resolve independently without cross-talk', () => {
  const probeCount = 50;
  const results = new Array(probeCount).fill(null);
  const probes = [];

  for (let i = 0; i < probeCount; i++) {
    const probe = new MockDetachedAudio(Infinity);
    probes.push(probe);
    const expectedDuration = 5 + i * 1.5;

    const handleProbeCompute = () => {
      if (probe && probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
        results[i] = probe.duration;
        probe.src = '';
      } else if (probe && probe.duration === Infinity) {
        const onSeeked = () => {
          if (probe) {
            probe.removeEventListener('seeked', onSeeked);
            if (probe.duration && !isNaN(probe.duration) && probe.duration !== Infinity) {
              results[i] = probe.duration;
            }
            probe.src = '';
          }
        };
        probe.addEventListener('seeked', onSeeked);
        probe.currentTime = 1e101;
      }
    };

    probe.addEventListener('loadedmetadata', handleProbeCompute);
    probe.emit('loadedmetadata');
    
    // Simulate staggered network responses
    probe.duration = expectedDuration;
    probe.emit('seeked');
  }

  for (let i = 0; i < probeCount; i++) {
    assert.equal(results[i], 5 + i * 1.5, `Probe #${i} must resolve its own discrete duration`);
    assert.equal(probes[i].src, '', `Probe #${i} must release src`);
  }
});

test('ADVERSARIAL: prepareFiniteMediaDuration handles 0, negative, NaN, Infinity, and instant finite durations', () => {
  // Case 1: Initial finite duration
  const media1 = new MockDetachedAudio(12.3);
  let duration1 = null;
  const clean1 = prepareFiniteMediaDuration(media1, d => { duration1 = d; });
  assert.equal(duration1, 12.3);
  assert.equal(media1.currentTime, 0);
  clean1();

  // Case 2: Zero or negative duration initially, then becomes finite
  const media2 = new MockDetachedAudio(0);
  let duration2 = null;
  const clean2 = prepareFiniteMediaDuration(media2, d => { duration2 = d; });
  assert.equal(duration2, null, 'Duration of 0 must not be treated as finite valid audio');

  media2.duration = -5;
  media2.emit('durationchange');
  assert.equal(duration2, null, 'Negative duration must not settle');

  media2.duration = 24.8;
  media2.emit('durationchange');
  assert.equal(duration2, 24.8, 'Positive finite duration must settle');
  assert.equal(media2.currentTime, 0);
  clean2();

  // Case 3: Null media or invalid callback does not crash
  assert.doesNotThrow(() => prepareFiniteMediaDuration(null, () => {}));
  assert.doesNotThrow(() => prepareFiniteMediaDuration(media2, null));
});

// ============================================================================
// 2. TELEGRAM MESSAGE GROUPING & 8-COLOR PALETTE EDGE CASES
// ============================================================================

/**
 * Bubble identity as MessageBubble derives it: grouping comes from the real
 * getMessageGrouping; the sender name shows on the first bubble of another
 * member's group in group chats.
 */
function computeGrouping({ messages, index, currentUser, activeChat }) {
  const msg = messages[index];
  const isMe = msg.senderId === currentUser?.id || msg.senderId === 'current';
  const isGroupOther = activeChat?.type === 'group' && !isMe;
  const { isFirstInGroup, isLastInGroup } = getMessageGrouping(msg, messages[index - 1], messages[index + 1]);
  return {
    isMe,
    isGroupOther,
    isFirstInGroup,
    isLastInGroup,
    showSenderName: isGroupOther && isFirstInGroup,
    senderColor: getSenderColor(msg.senderId || msg.sender_id || msg.senderName),
  };
}

test('ADVERSARIAL: sender colour palette full distribution & deterministic hashing', () => {
  const palette = Array.from({ length: SENDER_COLOR_COUNT }, (_, index) => `var(--sender-color-${index})`);
  const hits = new Set();
  const testInputs = [
    'a', 'b', 'c', 'user1', 'user2', 'user_alpha', 'user_beta',
    'alice', 'bob', 'charlie', 'david', 'elena', 'felix', 'gleb', 'helen',
    'Сергей', 'Алексей', 'Дмитрий', 'Мария', 'Екатерина', 'Владислав',
    '🔥', '💎', '🚀', '⭐', 'user_1234567890_super_long_identifier_test',
    '00000000-0000-0000-0000-000000000001',
    '99999999-9999-9999-9999-999999999999'
  ];

  for (const input of testInputs) {
    const color = getSenderColor(input);
    assert.ok(palette.includes(color), `Color ${color} must be one of the theme sender colours`);
    hits.add(color);
    assert.equal(getSenderColor(input), color, 'Hashing must be strictly deterministic');
  }

  // 500 pseudorandom inputs must reach every palette entry.
  for (let i = 0; i < 500; i++) {
    const col = getSenderColor(`usr_${Math.sin(i).toString(36).substring(2, 10)}`);
    assert.ok(palette.includes(col));
    hits.add(col);
  }

  assert.equal(hits.size, SENDER_COLOR_COUNT, 'All palette colours must be reachable via the hash');
  assert.equal(getSenderColor(null), 'var(--accent-color)', 'Missing sender falls back to the accent colour');
  assert.equal(getSenderColor(''), 'var(--accent-color)', 'Empty sender falls back to the accent colour');
});

test('ADVERSARIAL: grouping splits at midnight even within 10 minutes', () => {
  const lateEvening = new Date(2026, 7, 20, 23, 58);
  const afterMidnight = new Date(2026, 7, 21, 0, 2);
  const messages = [
    { id: 'm1', senderId: 'user_other', timestamp: lateEvening.toISOString() },
    { id: 'm2', senderId: 'user_other', timestamp: afterMidnight.toISOString() },
  ];
  const currentUser = { id: 'me' };
  const activeChat = { type: 'group' };
  assert.equal(computeGrouping({ messages, index: 0, currentUser, activeChat }).isLastInGroup, true);
  assert.equal(computeGrouping({ messages, index: 1, currentUser, activeChat }).isFirstInGroup, true,
    'a date divider separates them, so the bubbles must not merge');
});

test('ADVERSARIAL: Telegram grouping exact boundary at 9m59s vs 10m00s vs 10m01s', () => {
  const baseTime = new Date('2026-08-20T14:00:00.000Z').getTime();
  const activeChat = { id: 'group_test', type: 'group' };
  const currentUser = { id: 'user_self' };

  // Case 1: Exactly 9 minutes 59 seconds (599,000 ms) -> WITHIN 10m (< 600,000 ms) -> GROUPED
  const messages9m59s = [
    { id: 'm1', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime).toISOString() },
    { id: 'm2', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime + 599 * 1000).toISOString() }
  ];

  const g1 = computeGrouping({ messages: messages9m59s, index: 0, currentUser, activeChat });
  const g2 = computeGrouping({ messages: messages9m59s, index: 1, currentUser, activeChat });

  assert.equal(g1.isFirstInGroup, true);
  assert.equal(g1.isLastInGroup, false, 'm1 is followed by m2 within 9m59s -> not last in group');
  assert.equal(g1.showSenderName, true, 'm1 shows sender name');

  assert.equal(g2.isFirstInGroup, false, 'm2 is grouped with m1 -> not first in group');
  assert.equal(g2.isLastInGroup, true, 'm2 is last in group (gets avatar)');
  assert.equal(g2.showSenderName, false, 'm2 hides sender name');

  // Case 2: Exactly 9 minutes 59.999 seconds (599,999 ms) -> WITHIN 10m -> GROUPED
  const messages9m59_999s = [
    { id: 'm1', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime).toISOString() },
    { id: 'm2', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime + 599999).toISOString() }
  ];
  const g3 = computeGrouping({ messages: messages9m59_999s, index: 0, currentUser, activeChat });
  const g4 = computeGrouping({ messages: messages9m59_999s, index: 1, currentUser, activeChat });
  assert.equal(g3.isLastInGroup, false);
  assert.equal(g4.isFirstInGroup, false);

  // Case 3: Exactly 10 minutes 00.000 seconds (600,000 ms) -> NOT (< 600,000 ms) -> SPLIT INTO 2 SEPARATE GROUPS
  const messages10m00s = [
    { id: 'm1', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime).toISOString() },
    { id: 'm2', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime + 600000).toISOString() }
  ];
  const g5 = computeGrouping({ messages: messages10m00s, index: 0, currentUser, activeChat });
  const g6 = computeGrouping({ messages: messages10m00s, index: 1, currentUser, activeChat });
  assert.equal(g5.isFirstInGroup, true);
  assert.equal(g5.isLastInGroup, true, 'm1 is its own cluster at exact 10m threshold');
  assert.equal(g5.showSenderName, true);
  assert.equal(g6.isFirstInGroup, true, 'm2 starts new cluster');
  assert.equal(g6.isLastInGroup, true);
  assert.equal(g6.showSenderName, true);

  // Case 4: 10 minutes 01 seconds (601,000 ms) -> SPLIT INTO 2 SEPARATE GROUPS
  const messages10m01s = [
    { id: 'm1', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime).toISOString() },
    { id: 'm2', senderId: 'user_other', senderName: 'Other', timestamp: new Date(baseTime + 601000).toISOString() }
  ];
  const g7 = computeGrouping({ messages: messages10m01s, index: 0, currentUser, activeChat });
  const g8 = computeGrouping({ messages: messages10m01s, index: 1, currentUser, activeChat });
  assert.equal(g7.isFirstInGroup, true);
  assert.equal(g7.isLastInGroup, true);
  assert.equal(g8.isFirstInGroup, true);
  assert.equal(g8.isLastInGroup, true);
});

test('ADVERSARIAL: Single message vs 10-message cluster structure in group chat', () => {
  const baseTime = new Date('2026-08-20T15:00:00Z').getTime();
  const activeChat = { id: 'grp_stress', type: 'group' };
  const currentUser = { id: 'me_id' };

  // Single message
  const single = [{ id: 's1', senderId: 'user_alice', senderName: 'Alice', timestamp: new Date(baseTime).toISOString() }];
  const singleRes = computeGrouping({ messages: single, index: 0, currentUser, activeChat });
  assert.equal(singleRes.isFirstInGroup, true);
  assert.equal(singleRes.isLastInGroup, true);
  assert.equal(singleRes.showSenderName, true);

  // 10-message cluster (each 30s apart)
  const cluster10 = [];
  for (let i = 0; i < 10; i++) {
    cluster10.push({
      id: `c_${i}`,
      senderId: 'user_bob',
      senderName: 'Bob',
      timestamp: new Date(baseTime + i * 30 * 1000).toISOString()
    });
  }

  const results10 = cluster10.map((_, idx) =>
    computeGrouping({ messages: cluster10, index: idx, currentUser, activeChat })
  );

  // Message 0 (First in cluster)
  assert.equal(results10[0].isFirstInGroup, true, 'Message 0 must be first in group');
  assert.equal(results10[0].isLastInGroup, false, 'Message 0 must NOT be last in group');
  assert.equal(results10[0].showSenderName, true, 'Message 0 must show sender nickname');

  // Messages 1..8 (Intermediate in cluster)
  for (let i = 1; i <= 8; i++) {
    assert.equal(results10[i].isFirstInGroup, false, `Message ${i} must NOT be first in group`);
    assert.equal(results10[i].isLastInGroup, false, `Message ${i} must NOT be last in group`);
    assert.equal(results10[i].showSenderName, false, `Message ${i} must NOT show sender nickname`);
  }

  // Message 9 (Last in cluster)
  assert.equal(results10[9].isFirstInGroup, false, 'Message 9 must NOT be first in group');
  assert.equal(results10[9].isLastInGroup, true, 'Message 9 must be last in group (gets avatar)');
  assert.equal(results10[9].showSenderName, false, 'Message 9 must NOT show sender nickname');
});

test('ADVERSARIAL: Alternate key resolution (sender_id vs senderId vs senderName) and own messages', () => {
  const baseTime = new Date('2026-08-20T16:00:00Z').getTime();
  const activeChat = { id: 'group_test', type: 'group' };
  const currentUser = { id: 'user_me' };

  // Messages with varying property names for sender identification
  const messages = [
    { id: '1', sender_id: 'user_dan', timestamp: new Date(baseTime).toISOString() },
    { id: '2', senderId: 'user_dan', timestamp: new Date(baseTime + 10000).toISOString() },
    // Own message
    { id: '3', senderId: 'user_me', timestamp: new Date(baseTime + 20000).toISOString() },
    { id: '4', senderId: 'user_me', timestamp: new Date(baseTime + 30000).toISOString() }
  ];

  const r1 = computeGrouping({ messages, index: 0, currentUser, activeChat });
  const r2 = computeGrouping({ messages, index: 1, currentUser, activeChat });
  const r3 = computeGrouping({ messages, index: 2, currentUser, activeChat });
  const r4 = computeGrouping({ messages, index: 3, currentUser, activeChat });

  // Other user grouping across sender_id and senderId
  assert.equal(r1.isFirstInGroup, true);
  assert.equal(r1.isLastInGroup, false);
  assert.equal(r1.showSenderName, true);

  assert.equal(r2.isFirstInGroup, false);
  assert.equal(r2.isLastInGroup, true);
  assert.equal(r2.showSenderName, false);

  // Own messages: isMe = true -> showSenderName = false ALWAYS
  assert.equal(r3.isMe, true);
  assert.equal(r3.isFirstInGroup, true);
  assert.equal(r3.isLastInGroup, false);
  assert.equal(r3.showSenderName, false, 'Own message must never show sender name');

  assert.equal(r4.isMe, true);
  assert.equal(r4.isFirstInGroup, false);
  assert.equal(r4.isLastInGroup, true);
  assert.equal(r4.showSenderName, false);
});

// ============================================================================
// 3. SCROLL POSITION RETENTION ON DELETIONS & REACTIONS
// ============================================================================

class ComprehensiveScrollHarness {
  constructor(initialMessages = [], scrollTop = 600, scrollHeight = 2000, clientHeight = 600) {
    this.messages = [...initialMessages];
    this.scrollTop = scrollTop;
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.prevMessageCount = this.messages.length;
    this.prevLatestMessageId = this.messages[this.messages.length - 1]?.id || null;
    this.shouldAutoScroll = this.getDistanceFromBottom() < 120;
    this.scrollHistory = [];
  }

  getDistanceFromBottom() {
    return this.scrollHeight - this.scrollTop - this.clientHeight;
  }

  scrollToBottom(behavior = 'smooth') {
    this.scrollHistory.push({ type: 'scrollToBottom', behavior, prevTop: this.scrollTop });
    this.scrollTop = this.scrollHeight - this.clientHeight;
  }

  // Runs the same policy calls as useChatScroll's message-update effect.
  applyMessageUpdate(newMessages, currentUserId) {
    const latestMessage = newMessages[newMessages.length - 1];
    const latestMessageId = latestMessage?.id;
    const messageCount = newMessages.length;

    const { isNewMessage, isOwnMessage } = classifyMessageListUpdate({
      previousCount: this.prevMessageCount,
      previousLatestId: this.prevLatestMessageId,
      count: messageCount,
      latestId: latestMessageId,
      latestSenderId: latestMessage?.senderId,
      currentUserId,
    });
    const behavior = getNewMessageScrollBehavior({
      isNewMessage,
      isOwnMessage,
      isHydrating: isHydratingChatHistory({
        isInitialChatLoad: false,
        isChatLoading: false,
        previousCount: this.prevMessageCount,
        count: messageCount,
      }),
      isLoadingOlder: false,
      shouldAutoScroll: this.shouldAutoScroll,
    });
    if (behavior) this.scrollToBottom(behavior);

    this.prevMessageCount = messageCount;
    this.prevLatestMessageId = latestMessageId;
    this.messages = [...newMessages];
  }
}

test('ADVERSARIAL: Single and batch message deletions retain exact scroll offset', () => {
  const initialMessages = [
    { id: 'm1', text: 'First', senderId: 'u1' },
    { id: 'm2', text: 'Second', senderId: 'u2' },
    { id: 'm3', text: 'Third', senderId: 'u1' },
    { id: 'm4', text: 'Fourth', senderId: 'u3' },
    { id: 'm5', text: 'Fifth', senderId: 'u2' }
  ];

  // User reading middle history (distanceFromBottom = 2000 - 800 - 600 = 600 > 120)
  const harness = new ComprehensiveScrollHarness(initialMessages, 800, 2000, 600);
  assert.equal(harness.shouldAutoScroll, false);

  // 1. Delete middle message (m3)
  harness.applyMessageUpdate(
    initialMessages.filter(m => m.id !== 'm3'),
    'u1'
  );
  assert.equal(harness.scrollHistory.length, 0, 'No scroll event on middle deletion');
  assert.equal(harness.scrollTop, 800, 'ScrollTop must remain 800');

  // 2. Delete latest message (m5) - note messageCount drops even though latestMessageId changes!
  harness.applyMessageUpdate(
    [initialMessages[0], initialMessages[1], initialMessages[3]],
    'u1'
  );
  assert.equal(harness.scrollHistory.length, 0, 'No scroll event on latest message deletion');
  assert.equal(harness.scrollTop, 800, 'ScrollTop must remain 800');

  // 3. Batch delete all except 1 message
  harness.applyMessageUpdate([initialMessages[0]], 'u1');
  assert.equal(harness.scrollHistory.length, 0, 'No scroll event on batch deletion');
  assert.equal(harness.scrollTop, 800);
});

test('ADVERSARIAL: 20 rapid reaction toggles preserve scroll position with 0 autoscrolls', () => {
  const initialMessages = [
    { id: 'm1', text: 'Msg 1', senderId: 'u1', reactions: [] },
    { id: 'm2', text: 'Msg 2', senderId: 'u2', reactions: [] },
    { id: 'm3', text: 'Msg 3', senderId: 'u1', reactions: [] }
  ];

  // User positioned in mid scroll
  const harness = new ComprehensiveScrollHarness(initialMessages, 500, 2000, 600);
  const emojis = ['👍', '❤️', '🔥', '🚀', '🎉'];

  let currentList = [...initialMessages];

  for (let cycle = 0; cycle < 20; cycle++) {
    const targetMsgIdx = cycle % 3;
    const emoji = emojis[cycle % emojis.length];

    currentList = currentList.map((msg, idx) => {
      if (idx !== targetMsgIdx) return msg;
      const existing = msg.reactions.find(r => r.emoji === emoji);
      let updatedReactions;
      if (existing) {
        updatedReactions = msg.reactions.filter(r => r.emoji !== emoji);
      } else {
        updatedReactions = [...msg.reactions, { emoji, count: 1, users: ['u1'] }];
      }
      return { ...msg, reactions: updatedReactions };
    });

    harness.applyMessageUpdate(currentList, 'u1');
    assert.equal(harness.scrollHistory.length, 0, `Cycle #${cycle}: reaction mutation must NOT trigger autoscroll`);
    assert.equal(harness.scrollTop, 500, `Cycle #${cycle}: scrollTop must remain 500`);
  }
});

test('ADVERSARIAL: Pagination top compensation formula preserves visible viewport anchor', () => {
  const previousTop = 15; // User scrolled near top to trigger older load
  const previousHeight = 1200;
  const newHeight = 2600; // Loaded 30 older messages above

  const compensatedScrollTop = getPaginationRestoreTop({
    shouldAutoScroll: false,
    scrollHeight: newHeight,
    anchorOffsetTop: null,
    anchorOffset: 0,
    previousTop,
    previousHeight,
  });

  assert.equal(compensatedScrollTop, 15 + 1400, 'Compensated scrollTop must push viewport down by exactly the added height (1415px)');
});
