import assert from 'node:assert/strict';
import test from 'node:test';
import { callFrameMilestone } from './e2e/call-diagnostics.mjs';

test('call diagnostics retain only allowlisted JSON protocol fields', () => {
  const secretPayload = { access_token: 'token-secret', callerId: 'private-user', text: 'private-message' };
  assert.deepEqual(callFrameMilestone(JSON.stringify([null, '1', 'realtime:call:chat:private-chat', 'phx_reply', { status: 'error', ...secretPayload }])), {
    kind: 'phx_reply', channel: 'invitation', status: 'error'
  });
  assert.equal(callFrameMilestone(JSON.stringify([null, '1', 'realtime:messages:private-chat', 'phx_join', secretPayload])), null);
  assert.equal(callFrameMilestone(JSON.stringify([null, '1', 'realtime:call:chat:private-chat', 'unknown-private-event', secretPayload])), null);
});

test('call diagnostics decode binary broadcast headers without retaining payloads or identifiers', () => {
  const topic = Buffer.from('realtime:call:chat:private-chat');
  const event = Buffer.from('incoming-call');
  const secret = Buffer.from('{"access_token":"token-secret","callerId":"private-user","text":"private-message"}');
  const push = Buffer.concat([Buffer.from([3, 1, 1, topic.length, event.length, 0, 1]), Buffer.from('12'), topic, event, secret]);
  const receive = Buffer.concat([Buffer.from([4, topic.length, event.length, 0, 1]), topic, event, secret]);
  for (const frame of [push, receive]) {
    assert.deepEqual(callFrameMilestone(frame), { kind: 'incoming-call', channel: 'invitation' });
    assert.doesNotMatch(JSON.stringify(callFrameMilestone(frame)), /private|secret|token|caller|text/);
  }
});
