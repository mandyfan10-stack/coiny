import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMessageListUpdate,
  getNewMessageScrollBehavior,
  isHydratingChatHistory,
} from '../src/components/chat/chatScrollPolicy.ts';

// When does a message-list change move the view? These run the same policy
// functions useChatScroll calls on every list update.

/**
 * Drives successive message lists through the policy the way useChatScroll's
 * effect does, recording the scroll behaviour each update would trigger.
 */
function createFollower({ messages, currentUserId = 'u1', shouldAutoScroll = true, isInitialChatLoad = false }) {
  const state = {
    previousCount: messages.length,
    previousLatestId: messages.at(-1)?.id,
    shouldAutoScroll,
    isInitialChatLoad,
    scrolls: [],
  };
  return {
    state,
    update(next, { isChatLoading = false, isLoadingOlder = false } = {}) {
      const latest = next.at(-1);
      const { isNewMessage, isOwnMessage } = classifyMessageListUpdate({
        previousCount: state.previousCount,
        previousLatestId: state.previousLatestId,
        count: next.length,
        latestId: latest?.id,
        latestSenderId: latest?.senderId,
        currentUserId,
      });
      const behavior = getNewMessageScrollBehavior({
        isNewMessage,
        isOwnMessage,
        isHydrating: isHydratingChatHistory({
          isInitialChatLoad: state.isInitialChatLoad,
          isChatLoading,
          previousCount: state.previousCount,
          count: next.length,
        }),
        isLoadingOlder,
        shouldAutoScroll: state.shouldAutoScroll,
      });
      if (behavior) state.scrolls.push(behavior);
      state.previousCount = next.length;
      state.previousLatestId = latest?.id;
      return behavior;
    },
  };
}

const msg = (id, senderId = 'u2', extra = {}) => ({ id, senderId, text: `text ${id}`, ...extra });

test('deleting a message never scrolls', () => {
  const initial = [msg('1', 'u1'), msg('2'), msg('3', 'u1')];
  const chat = createFollower({ messages: initial, shouldAutoScroll: false });
  chat.update([initial[0], initial[2]]);
  assert.deepEqual(chat.state.scrolls, []);
});

test('toggling a reaction or editing keeps the tail and never scrolls', () => {
  const initial = [msg('1', 'u1'), msg('2')];
  const chat = createFollower({ messages: initial });
  chat.update([initial[0], { ...initial[1], reactions: [{ emoji: '👍', count: 1, users: ['u1'] }] }]);
  chat.update([initial[0], { ...initial[1], text: 'edited' }]);
  assert.deepEqual(chat.state.scrolls, [], 'same length and tail id is not a new message, even while pinned');
});

test('replacing the tail without growing the list is not a new message', () => {
  const chat = createFollower({ messages: [msg('1'), msg('optimistic', 'u1')] });
  // Server confirmation swaps the optimistic id in place.
  chat.update([msg('1'), msg('server-id', 'u1')]);
  assert.deepEqual(chat.state.scrolls, []);
});

test('an own message always jumps to the bottom instantly, even when reading history', () => {
  const chat = createFollower({ messages: [msg('0'), msg('1')], shouldAutoScroll: false });
  assert.equal(chat.update([msg('0'), msg('1'), msg('2', 'u1')]), 'auto');
  assert.equal(chat.update([msg('0'), msg('1'), msg('2', 'u1'), msg('3', 'current')]), 'auto', 'mock-mode sender id counts as own');
});

test('an incoming message follows smoothly only while the reader is pinned', () => {
  const reading = createFollower({ messages: [msg('0'), msg('1')], shouldAutoScroll: false });
  assert.equal(reading.update([msg('0'), msg('1'), msg('2')]), null);

  const pinned = createFollower({ messages: [msg('0'), msg('1')], shouldAutoScroll: true });
  assert.equal(pinned.update([msg('0'), msg('1'), msg('2')]), 'smooth');
});

test('entering a chat and hydrating its history does not count as new messages', () => {
  const chat = createFollower({ messages: [msg('preview')], isInitialChatLoad: true });
  const history = Array.from({ length: 30 }, (_, index) => msg(`h${index}`));
  assert.equal(chat.update(history), null, 'initial restore phase');

  chat.state.isInitialChatLoad = false;
  const fromPreview = createFollower({ messages: [msg('preview')] });
  assert.equal(fromPreview.update(history), null, 'growing from a 1-message preview is hydration');
  // Consequence: in a chat holding a single message, the second one is also
  // treated as hydration. Harmless: two rows never overflow the viewport.
  assert.equal(createFollower({ messages: [msg('only')] }).update([msg('only'), msg('second', 'u1')]), null);

  assert.equal(chat.update([...history, msg('live')]), 'smooth', 'a real arrival afterwards still follows');
});

test('messages arriving while history loads or older pages prepend do not scroll', () => {
  const chat = createFollower({ messages: [msg('1'), msg('2')] });
  assert.equal(chat.update([msg('1'), msg('2'), msg('3')], { isChatLoading: true }), null);
  assert.equal(chat.update([msg('1'), msg('2'), msg('3'), msg('4')], { isLoadingOlder: true }), null);
});

test('rapid reaction cycles never accumulate scrolls', () => {
  let list = [msg('1', 'u1', { reactions: [] }), msg('2', 'u2', { reactions: [] })];
  const chat = createFollower({ messages: list, shouldAutoScroll: false });
  for (let cycle = 0; cycle < 50; cycle += 1) {
    list = list.map(item => (item.id === '2'
      ? { ...item, reactions: cycle % 2 ? [] : [{ emoji: '🔥', count: 1, users: ['u1'] }] }
      : item));
    chat.update(list);
  }
  assert.deepEqual(chat.state.scrolls, []);
});

test('classification reports own vs incoming only for genuinely new tails', () => {
  const base = { previousCount: 2, previousLatestId: 'b', currentUserId: 'me' };
  assert.deepEqual(classifyMessageListUpdate({ ...base, count: 3, latestId: 'c', latestSenderId: 'me' }), { isNewMessage: true, isOwnMessage: true });
  assert.deepEqual(classifyMessageListUpdate({ ...base, count: 3, latestId: 'c', latestSenderId: 'them' }), { isNewMessage: true, isOwnMessage: false });
  assert.deepEqual(classifyMessageListUpdate({ ...base, count: 3, latestId: 'b', latestSenderId: 'me' }), { isNewMessage: false, isOwnMessage: false },
    'an older page prepended keeps the tail');
});
