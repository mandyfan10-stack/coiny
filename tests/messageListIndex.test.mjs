import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessageListIndex } from '../src/utils/messageListIndex.ts';

test('unread divider excludes own messages and honors the server unread count', () => {
  const messages = [
    { id: 'own', senderId: 'alice' }, { id: 'alias', senderId: 'current' },
    { id: 'read', senderId: 'bob', read: true }, { id: 'unread', senderId: 'bob', read: false }
  ];
  assert.equal(buildMessageListIndex(messages, 'alice').firstUnreadIndex, 3);
  assert.equal(buildMessageListIndex(messages, 'alice', 2).firstUnreadIndex, 2);
  assert.equal(buildMessageListIndex(messages, 'alice', 8).firstUnreadIndex, -4);
  assert.equal(buildMessageListIndex([], 'alice').firstUnreadIndex, -1);
});

test('reply lookup preserves first-match semantics, missing targets, edits and deletions', () => {
  const first = { id: 'first', text: 'before', read: true };
  const index = buildMessageListIndex([first, { id: 'first', text: 'duplicate' }, { id: 'reply', replyTo: 'first' }]);
  assert.equal(index.messagesById.get('first'), first);
  assert.equal(index.messagesById.get('missing'), undefined);
  const edited = { ...first, text: 'after' };
  assert.equal(buildMessageListIndex([edited]).messagesById.get('first').text, 'after');
  assert.equal(buildMessageListIndex([]).messagesById.has('first'), false);
});

test('all-read long histories require a linear number of element reads', () => {
  let reads = 0;
  const count = 10000;
  const messages = new Proxy(Array.from({ length: count }, (_, i) => ({ id: String(i), read: true, senderId: 'bob' })), {
    get(array, property) { if (/^\d+$/.test(String(property))) reads += 1; return Reflect.get(array, property); }
  });
  const index = buildMessageListIndex(messages, 'alice');
  for (let i = 0; i < count; i += 1) assert.equal(index.messagesById.get(String(i)).id, String(i));
  assert.equal(index.firstUnreadIndex, -1);
  assert.equal(reads, count);
});
