import assert from 'node:assert/strict';
import test from 'node:test';
import { createCallPeerSession } from '../src/context/calls/callPeerSession.js';

class Peer extends EventTarget {
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:local\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\na=ice-ufrag:answer\r\n' }; }
  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
}

const drain = () => new Promise(resolve => setImmediate(resolve));
function harness(t, options = {}) {
  const sent = [];
  const errors = [];
  const session = createCallPeerSession({
    pc: new Peer(), polite: false, send: signal => sent.push(signal), onError: error => errors.push(error),
    schedule: () => 1, cancel: () => {}, ...options
  });
  t.after(() => session.dispose());
  return { session, sent, errors };
}

test('accepted SDP carries the committed video revision for camera, disabled video and screen', async t => {
  let kind = 'camera';
  let revision = 1;
  const received = [];
  const caller = harness(t, { getVideoKind: () => kind, getVideoRevision: () => revision });
  const receiver = harness(t, { getVideoKind: () => null, getVideoRevision: () => 0,
    onRemoteVideoKind: (kind, revision) => received.push({ kind, revision }) });
  for (const next of ['camera', null, 'screen']) {
    kind = next;
    await caller.session.negotiate();
    await drain();
    const offer = caller.sent.at(-1);
    assert.equal(offer.videoKind, kind);
    assert.equal(offer.videoRevision, revision);
    await receiver.session.receive(offer);
    await drain();
    const answer = receiver.sent.at(-1);
    assert.equal(answer.videoKind, null);
    assert.equal(answer.videoRevision, 0);
    await caller.session.receive(answer);
    revision++;
  }
  assert.deepEqual(received, [{ kind: 'camera', revision: 1 }, { kind: null, revision: 2 }, { kind: 'screen', revision: 3 }]);
  assert.deepEqual(caller.errors, []);
  assert.deepEqual(receiver.errors, []);
});

test('legacy source metadata remains readable without a revision', async t => {
  const accepted = [];
  const legacy = harness(t, { getVideoKind: () => 'camera' });
  const receiver = harness(t, { onRemoteVideoKind: (kind, revision) => accepted.push({ kind, revision }) });
  await legacy.session.negotiate();
  await drain();
  assert.equal(Object.hasOwn(legacy.sent[0], 'videoRevision'), false);
  await receiver.session.receive(legacy.sent[0]);
  await drain();
  assert.deepEqual(accepted, [{ kind: 'camera', revision: undefined }]);
});

test('invalid revision values are omitted and reach the compatibility path', async t => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
    const accepted = [];
    const caller = harness(t, { getVideoKind: () => 'screen', getVideoRevision: () => value });
    const receiver = harness(t, { onRemoteVideoKind: (kind, revision) => accepted.push({ kind, revision }) });
    await caller.session.negotiate();
    await drain();
    const offer = caller.sent[0];
    assert.equal(Object.hasOwn(offer, 'videoRevision'), false);
    await receiver.session.receive({ ...offer, videoRevision: value });
    assert.deepEqual(accepted, [{ kind: 'screen', revision: undefined }]);
  }
});
