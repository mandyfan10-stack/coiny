import assert from 'node:assert/strict';
import test from 'node:test';
import { createCallInvitationDelivery } from '../src/context/calls/callInvitationDelivery.js';

function harness(send) {
  let time = 0;
  let id = 0;
  const timers = new Map();
  const delivery = createCallInvitationDelivery({
    send, now: () => time,
    schedule: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
    cancel: (key) => timers.delete(key)
  });
  return { delivery, timers, async advance(ms) {
    await new Promise((resolve) => setImmediate(resolve));
    const target = time + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    time = target;
  } };
}

const invite = (callId = 'call-1') => ({ callId, expiresAt: 60_000 });

test('invitation retries after successful server delivery until the intended peer confirms receipt', async () => {
  const sent = [];
  const { delivery, advance, timers } = harness(async (...args) => sent.push(args));
  delivery.start('chat-1', invite(), ['peer']);
  await advance(4_500);
  assert.equal(sent.length, 4);
  delivery.acknowledge('another-chat', 'call-1', 'peer');
  delivery.acknowledge('chat-1', 'another-call', 'peer');
  delivery.acknowledge('chat-1', 'call-1', 'bystander');
  await advance(1_500);
  assert.equal(sent.length, 5);
  delivery.acknowledge('chat-1', 'call-1', 'peer');
  await advance(60_000);
  assert.equal(sent.length, 5);
  assert.equal(timers.size, 0);
});

test('group receipt only stops retries once all invited members acknowledge', async () => {
  const sent = [];
  const { delivery, advance } = harness(async (...args) => sent.push(args));
  delivery.start('group', invite(), ['peer-1', 'peer-2']);
  delivery.acknowledge('group', 'call-1', 'peer-1');
  await advance(1_500);
  assert.equal(sent.length, 2);
  delivery.acknowledge('group', 'call-1', 'peer-2');
  await advance(1_500);
  assert.equal(sent.length, 2);
});

test('disconnected transport is retried and an unanswered invitation expires', async () => {
  let connected = false;
  const received = [];
  const { delivery, advance, timers } = harness(async (...args) => { if (connected) received.push(args); });
  delivery.start('chat', invite(), ['peer']);
  await advance(3_000);
  assert.equal(received.length, 0);
  connected = true;
  await advance(1_500);
  assert.equal(received.length, 1);
  await advance(60_000);
  assert.equal(delivery.isCurrent('chat', 'call-1'), false);
  const count = received.length;
  await advance(60_000);
  assert.equal(received.length, count);
  assert.equal(timers.size, 0);
});

test('cancellation and replacement discard old retries and old receipts', async () => {
  const sent = [];
  const { delivery, advance } = harness(async (_chat, _event, payload) => sent.push(payload.callId));
  delivery.start('chat', invite(), ['peer']);
  delivery.stop();
  await advance(3_000);
  assert.deepEqual(sent, ['call-1']);
  delivery.start('chat', invite('call-2'), ['peer']);
  delivery.acknowledge('chat', 'call-1', 'peer');
  await advance(1_500);
  assert.deepEqual(sent, ['call-1', 'call-2', 'call-2']);
  delivery.stop();
});

test('a stalled send cannot overlap another send or extend the ringing deadline', async () => {
  let finish;
  let sends = 0;
  const { delivery, advance, timers } = harness(() => {
    sends += 1;
    return new Promise((resolve) => { finish = resolve; });
  });
  delivery.start('chat', invite(), ['peer']);
  await advance(90_000);
  assert.equal(sends, 1);
  assert.equal(delivery.isCurrent('chat', 'call-1'), false);
  assert.equal(timers.size, 0);
  finish();
});

test('a rejected send is retried instead of leaking an unhandled rejection', async () => {
  let attempts = 0;
  const { delivery, advance } = harness(async () => {
    attempts++;
    if (attempts === 1) throw new Error('temporary transport failure');
  });
  delivery.start('chat', invite(), ['peer']);
  await advance(1_500);
  assert.equal(attempts, 2);
  delivery.stop();
});
