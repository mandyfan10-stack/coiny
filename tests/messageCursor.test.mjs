import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMessages, getMessageCursor } from '../src/utils/messageCursor.ts';
import { createHistorySnapshot, retainCachedMessage } from '../src/utils/messageHistory.js';
import { normalizeCachedMessage, denormalizeCachedMessage } from '../src/utils/indexedDbHelper.js';

const timestamp = '2026-10-06T12:00:00.123456+00:00';
const message = (id, time = timestamp) => ({ id, createdAt: time, timestamp: new Date(time) });

test('cursor retains server microseconds through mapping and cache normalization', () => {
  const original = message('c');
  const cached = denormalizeCachedMessage(normalizeCachedMessage(original, 'chat', 'owner'));
  assert.deepEqual(getMessageCursor(original), { timestamp, id: 'c' });
  assert.deepEqual(getMessageCursor(cached), getMessageCursor(original));
  assert.equal(getMessageCursor({ id: 'c', timestamp: 'invalid' }), null);
});

test('message order follows time, including sub-millisecond precision, then ID', () => {
  const messages = [message('a', '2026-10-06T12:00:00.123457Z'), message('c'), message('b')];
  assert.deepEqual(messages.sort(compareMessages).map(item => item.id), ['b', 'c', 'a']);
  assert.equal(compareMessages(message('c'), message('c')), 0);
});

test('an empty or short authoritative history drops stale confirmed cache entries and keeps unsent messages', () => {
  for (const incoming of [[], [message('fresh')]]) {
    const snapshot = createHistorySnapshot(incoming, 100);
    assert.equal(retainCachedMessage(message('deleted', '2020-01-01T00:00:00Z'), snapshot), false);
    for (const flag of ['isPending', 'isOptimistic', 'isFailed']) {
      assert.equal(retainCachedMessage({ ...message('local'), [flag]: true }, snapshot), true);
    }
    assert.equal(snapshot.hasMore, false);
  }
});

test('a full page verifies only its covered (time, ID) range', () => {
  const snapshot = createHistorySnapshot([message('c'), message('d')], 2);
  assert.equal(retainCachedMessage(message('b'), snapshot), true);
  assert.equal(retainCachedMessage(message('c'), snapshot), true);
  assert.equal(retainCachedMessage(message('missing'), snapshot), false);
  assert.equal(retainCachedMessage(message('a', '2026-10-06T12:00:00.123457Z'), snapshot), false);
  assert.equal(snapshot.hasMore, true);
});
