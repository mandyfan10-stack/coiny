import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatAreaSource = readFileSync(
  new URL('../src/components/ChatArea.jsx', import.meta.url),
  'utf8'
);

class MockChatScrollState {
  constructor(initialMessages = [], initialScrollTop = 500, initialScrollHeight = 1000, clientHeight = 500) {
    this.messages = [...initialMessages];
    this.scrollTop = initialScrollTop;
    this.scrollHeight = initialScrollHeight;
    this.clientHeight = clientHeight;
    this.prevMessageCount = this.messages.length;
    this.prevLatestMessageId = this.messages[this.messages.length - 1]?.id || null;
    this.shouldAutoScroll = this.getDistanceFromBottom() < 120;
    this.scrollEvents = [];
  }

  getDistanceFromBottom() {
    return this.scrollHeight - this.scrollTop - this.clientHeight;
  }

  scrollToBottom(behavior = 'smooth') {
    this.scrollEvents.push({ type: 'scrollToBottom', behavior });
    this.scrollTop = this.scrollHeight - this.clientHeight;
  }

  // Simulate ChatArea's useEffect logic
  onMessageUpdate(newMessages, currentUserId) {
    const latestMessage = newMessages[newMessages.length - 1];
    const latestMessageId = latestMessage?.id;
    const latestMessageSenderId = latestMessage?.senderId;
    const messageCount = newMessages.length;

    const isNewMessage = (
      messageCount > this.prevMessageCount &&
      latestMessageId !== this.prevLatestMessageId
    );
    const isOwnMessage = isNewMessage && (latestMessageSenderId === currentUserId || latestMessageSenderId === 'current');

    if (isNewMessage) {
      if (this.shouldAutoScroll || isOwnMessage) {
        this.scrollToBottom('smooth');
      }
    }

    this.prevMessageCount = messageCount;
    this.prevLatestMessageId = latestMessageId;
    this.messages = [...newMessages];
  }
}

test('ChatArea contains guard preventing scroll jumps on message deletion and reaction toggle', () => {
  assert.match(
    chatAreaSource,
    /isNewMessage\s*=\s*\(\s*messageCount\s*>\s*prevMessageCountRef\.current\s*&&\s*latestMessageId\s*!==\s*prevLatestMessageIdRef\.current\s*\)/,
    'ChatArea must guard autoscroll with isNewMessage checks'
  );
  assert.match(
    chatAreaSource,
    /distanceFromBottom\s*=\s*scrollHeight\s*-\s*scrollTop\s*-\s*clientHeight/,
    'ChatArea must calculate distanceFromBottom accurately'
  );
  assert.match(
    chatAreaSource,
    /distanceFromBottom\s*<\s*120/,
    'ChatArea must use a 120px threshold when returning to the bottom pin'
  );
  assert.match(
    chatAreaSource,
    /chatBodyRef\.current\.scrollTop\s*=\s*previousTop\s*\+\s*chatBodyRef\.current\.scrollHeight\s*-\s*previousHeight/,
    'ChatArea must compensate scrollTop during older message pagination'
  );
});

test('Message deletion does not trigger autoscroll jump', () => {
  const initial = [
    { id: '1', text: 'Hello', senderId: 'u1' },
    { id: '2', text: 'World', senderId: 'u2' },
    { id: '3', text: 'Coiny', senderId: 'u1' }
  ];
  // User is scrolled mid-history (distanceFromBottom = 400 > 120)
  const chat = new MockChatScrollState(initial, 100, 1000, 500);
  assert.equal(chat.shouldAutoScroll, false);

  // Delete message 2
  const afterDelete = [initial[0], initial[2]];
  chat.onMessageUpdate(afterDelete, 'u1');

  assert.equal(chat.scrollEvents.length, 0, 'No autoscroll event should fire on message deletion');
  assert.equal(chat.scrollTop, 100, 'Scroll position must be preserved on deletion');
});

test('Reaction toggle does not trigger autoscroll jump', () => {
  const initial = [
    { id: '1', text: 'Hello', senderId: 'u1', reactions: [] },
    { id: '2', text: 'World', senderId: 'u2', reactions: [] }
  ];
  // User is scrolled mid-history
  const chat = new MockChatScrollState(initial, 150, 1000, 500);

  // Toggle reaction on message 2 (message count stays same, latest message id stays same)
  const afterReaction = [
    initial[0],
    { id: '2', text: 'World', senderId: 'u2', reactions: [{ emoji: '👍', count: 1, users: ['u1'] }] }
  ];
  chat.onMessageUpdate(afterReaction, 'u1');

  assert.equal(chat.scrollEvents.length, 0, 'No autoscroll event should fire on reaction toggle');
  assert.equal(chat.scrollTop, 150, 'Scroll position must be preserved on reaction toggle');
});

test('New own message always scrolls to bottom', () => {
  const initial = [
    { id: '1', text: 'Hello', senderId: 'u1' }
  ];
  const chat = new MockChatScrollState(initial, 0, 1000, 500);
  chat.shouldAutoScroll = false; // Even if user was scrolled up

  const newMessages = [
    ...initial,
    { id: '2', text: 'My own reply', senderId: 'u1' }
  ];
  chat.onMessageUpdate(newMessages, 'u1');

  assert.equal(chat.scrollEvents.length, 1);
  assert.equal(chat.scrollEvents[0].type, 'scrollToBottom');
});

test('New incoming message scrolls only when user is near bottom (<120px)', () => {
  const initial = [
    { id: '1', text: 'Hello', senderId: 'u1' }
  ];
  
  // Case A: User scrolled up -> no scroll on incoming
  const chatScrolledUp = new MockChatScrollState(initial, 0, 1000, 500);
  chatScrolledUp.shouldAutoScroll = false;
  chatScrolledUp.onMessageUpdate([...initial, { id: '2', text: 'Bob message', senderId: 'u2' }], 'u1');
  assert.equal(chatScrolledUp.scrollEvents.length, 0, 'Should not autoscroll when user is reading past history');

  // Case B: User at bottom -> autoscrolls smoothly
  const chatAtBottom = new MockChatScrollState(initial, 500, 1000, 500);
  chatAtBottom.shouldAutoScroll = true;
  chatAtBottom.onMessageUpdate([...initial, { id: '2', text: 'Bob message', senderId: 'u2' }], 'u1');
  assert.equal(chatAtBottom.scrollEvents.length, 1, 'Should autoscroll when user is at bottom');
});
