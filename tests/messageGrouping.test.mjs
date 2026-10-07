import test from 'node:test';
import assert from 'node:assert/strict';
import { getMessageGrouping } from '../src/utils/messageGrouping.ts';

const start = new Date(2026, 9, 6, 12).getTime();
const message = (minutes = 0, fields = {}) => ({ senderId: 'alice', timestamp: start + minutes * 60_000, ...fields });
const single = { isFirstInGroup: true, isLastInGroup: true };

test('consecutive messages classify the first, middle and last rows', () => {
  const [first, middle, last] = [message(0), message(1), message(2)];
  assert.deepEqual(getMessageGrouping(first, null, middle), { isFirstInGroup: true, isLastInGroup: false });
  assert.deepEqual(getMessageGrouping(middle, first, last), { isFirstInGroup: false, isLastInGroup: false });
  assert.deepEqual(getMessageGrouping(last, middle, null), { isFirstInGroup: false, isLastInGroup: true });
  assert.deepEqual(getMessageGrouping(first), single);
});

test('the ten-minute boundary starts a separate series', () => {
  assert.equal(getMessageGrouping(message(0), null, message(9.999)).isLastInGroup, false);
  assert.deepEqual(getMessageGrouping(message(0), null, message(10)), single);
  assert.deepEqual(getMessageGrouping(message(11), message(0), null), single);
});

test('a local date divider breaks a series even two minutes apart', () => {
  const before = message(0, { timestamp: new Date(2026, 9, 6, 23, 59).toISOString() });
  const after = message(0, { timestamp: new Date(2026, 9, 7, 0, 1).toISOString() });
  assert.deepEqual(getMessageGrouping(before, null, after), single);
  assert.deepEqual(getMessageGrouping(after, before, null), single);
});

test('different or absent sender identities never connect', () => {
  assert.deepEqual(getMessageGrouping(message(0), null, message(1, { senderId: 'bob' })), single);
  assert.deepEqual(getMessageGrouping(message(0, { senderId: undefined }), null, message(1, { senderId: undefined })), single);
});

test('legacy sender fields keep their existing grouping compatibility', () => {
  const legacy = message(1, { senderId: undefined, sender_id: 'alice' });
  const named = message(2, { senderId: undefined, senderName: 'alice' });
  assert.deepEqual(getMessageGrouping(legacy, message(0), named), { isFirstInGroup: false, isLastInGroup: false });
});

test('invalid or missing timestamps do not join neighboring messages', () => {
  for (const timestamp of [undefined, null, 'invalid']) {
    assert.deepEqual(getMessageGrouping(message(0, { timestamp }), message(0), message(1)), single);
  }
});

test('numeric, Date and ISO timestamps use the same grouping', () => {
  assert.deepEqual(getMessageGrouping(message(1, { timestamp: new Date(start + 60_000) }), message(0), message(2, { timestamp: new Date(start + 120_000).toISOString() })), { isFirstInGroup: false, isLastInGroup: false });
});
