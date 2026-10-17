import assert from 'node:assert/strict';
import test from 'node:test';
import { createCallPeerSession } from '../src/context/calls/callPeerSession.js';

const drain = () => new Promise((resolve) => setImmediate(resolve));
class Peer extends EventTarget {
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription = null;
  remoteDescription = null;
  offers = [];
  received = [];
  configurations = [];
  answerCount = 0;
  rollbacks = 0;
  async createOffer(options) {
    assert.equal(this.signalingState, 'stable');
    this.offers.push(options);
    return { type: 'offer', sdp: `v=0\r\na=ice-ufrag:offer${this.offers.length}\r\n` };
  }
  async createAnswer() {
    assert.equal(this.signalingState, 'have-remote-offer');
    return { type: 'answer', sdp: `v=0\r\na=ice-ufrag:answer${++this.answerCount}\r\n` };
  }
  async setLocalDescription(description) {
    if (description.type === 'rollback') {
      assert.equal(this.signalingState, 'have-local-offer');
      this.signalingState = 'stable'; this.localDescription = null; this.rollbacks += 1; return;
    }
    assert.equal(this.signalingState, description.type === 'offer' ? 'stable' : 'have-remote-offer');
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description) {
    if (description.type === 'offer' && this.signalingState === 'have-local-offer') {
      this.signalingState = 'stable'; this.rollbacks += 1;
    }
    assert.equal(this.signalingState, description.type === 'answer' ? 'have-local-offer' : 'stable');
    this.remoteDescription = description;
    this.signalingState = description.type === 'answer' ? 'stable' : 'have-remote-offer';
  }
  async addIceCandidate(candidate) { assert.ok(this.remoteDescription); this.received.push(candidate); }
  setConfiguration(configuration) { this.configurations.push(configuration); }
  state(value, ice = value) {
    this.connectionState = value; this.iceConnectionState = ice;
    this.dispatchEvent(new Event('connectionstatechange'));
    this.dispatchEvent(new Event('iceconnectionstatechange'));
  }
  candidate(fragment) {
    this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate: { candidate: 'candidate:local', usernameFragment: fragment } }));
  }
}
function harness(options = {}) {
  const pc = options.pc ?? new Peer();
  let time = 0; let id = 0;
  const timers = new Map(); const sent = []; const states = []; const errors = [];
  const session = createCallPeerSession({ pc, polite: true, send: (signal) => sent.push(signal),
    onState: (state) => states.push(state), onError: (error) => errors.push(error),
    schedule: (fn, ms) => { timers.set(++id, { fn, at: time + ms }); return id; },
    cancel: (key) => timers.delete(key), ...options });
  return { pc, session, sent, states, errors, timers, async advance(ms) {
    await drain(); const end = time + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn(); await drain();
    }
    time = end;
  } };
}
const answer = (offer) => ({ type: offer.type === 'offer' ? 'answer' : 'renegotiate-answer', negotiationId: offer.negotiationId, sdp: 'v=0\r\na=ice-ufrag:remote\r\n' });

test('a lost answer is recovered by resending identical offer and cached answer after receiver connects', async () => {
  const caller = harness({ polite: false }); const receiver = harness();
  await caller.session.negotiate(); await drain();
  const first = caller.sent[0];
  await receiver.session.receive(first); await drain();
  receiver.pc.state('connected');
  await caller.advance(1_000);
  assert.deepEqual(caller.sent[1], first);
  await receiver.session.receive(caller.sent[1]); await drain();
  assert.deepEqual(receiver.sent[1], receiver.sent[0]);
  assert.equal(receiver.pc.answerCount, 1);
  await caller.session.receive(receiver.sent[1]);
  assert.equal(caller.pc.signalingState, 'stable');
  assert.equal(caller.states.includes('connected'), false);
  caller.pc.state('connected'); assert.equal(caller.states.at(-1), 'connected');
  assert.equal(caller.timers.size, 0);
  caller.session.dispose(); receiver.session.dispose();
});

test('retry budget is bounded even if secure transport never resolves', async () => {
  let sends = 0;
  const h = harness({ send: () => { sends += 1; return new Promise(() => {}); } });
  await h.session.negotiate(); await h.advance(90_000);
  assert.equal(sends, 6); assert.equal(h.timers.size, 0); assert.equal(h.states.at(-1), 'failed');
  h.session.dispose();
});

test('polite glare rolls back while impolite peer ignores the colliding offer', async () => {
  const a = harness({ polite: false }); const b = harness();
  await Promise.all([a.session.negotiate(), b.session.negotiate()]); await drain();
  const aOffer = a.sent[0]; const bOffer = b.sent[0];
  await Promise.all([a.session.receive(bOffer), b.session.receive(aOffer)]); await drain();
  assert.equal(a.pc.rollbacks, 0); assert.equal(b.pc.rollbacks, 1);
  await a.session.receive(b.sent.find((signal) => signal.type === 'answer'));
  assert.equal(a.pc.signalingState, 'stable'); assert.equal(b.pc.signalingState, 'stable');
  await b.session.receive(answer(bOffer));
  assert.equal(b.pc.remoteDescription.type, 'offer');
  assert.equal(a.errors.length + b.errors.length, 0);
  a.session.dispose(); b.session.dispose();
});

test('camera negotiation during an outstanding offer is deferred and serialized', async () => {
  const h = harness();
  await h.session.negotiate(); await h.session.negotiate(); await drain();
  assert.equal(h.pc.offers.length, 1);
  await h.session.receive(answer(h.sent[0])); await drain();
  assert.equal(h.pc.offers.length, 2);
  assert.equal(h.sent.at(-1).type, 'renegotiate-offer');
  h.session.dispose();
});

test('old answers cannot settle a newer ICE restart; TURN configuration is applied before offer', async () => {
  const configuration = { iceServers: [{ urls: 'turn:example.org', username: 'fresh', credential: 'short-lived' }] };
  const h = harness({ polite: false, prepareRestart: async () => configuration });
  await h.session.negotiate(); await drain();
  const first = h.sent[0]; await h.session.receive(answer(first));
  h.pc.state('connected'); await h.session.recover({ force: true }); await drain();
  const restart = h.sent.at(-1);
  assert.notEqual(restart.negotiationId, first.negotiationId);
  assert.deepEqual(h.pc.configurations, [configuration]);
  assert.deepEqual(h.pc.offers[1], { iceRestart: true });
  await h.session.receive(answer(first)); assert.equal(h.pc.signalingState, 'have-local-offer');
  await h.session.receive(answer(restart)); assert.equal(h.pc.signalingState, 'stable');
  h.session.dispose();
});

test('ICE generations queue early candidates and reject candidates from retired or ignored offers', async () => {
  const h = harness();
  await h.session.receive({ type: 'candidate', negotiationId: 'next', candidate: { candidate: 'next', usernameFragment: 'next-ufrag' } });
  assert.equal(h.pc.received.length, 0);
  await h.session.receive({ type: 'offer', negotiationId: 'next', sdp: 'v=0\r\na=ice-ufrag:next-ufrag\r\n' });
  assert.equal(h.pc.received.length, 1);
  await h.session.receive({ type: 'offer', negotiationId: 'newer', sdp: 'v=0\r\na=ice-ufrag:new-ufrag\r\n' });
  await h.session.receive({ type: 'candidate', negotiationId: 'next', candidate: { candidate: 'stale', usernameFragment: 'next-ufrag' } });
  assert.equal(h.pc.received.length, 1);
  h.session.dispose();
});

test('lost trickle candidates are replayed with the offer', async () => {
  const h = harness(); await h.session.negotiate(); await drain();
  h.pc.candidate('offer1'); await drain();
  assert.equal(h.sent[1].negotiationId, h.sent[0].negotiationId);
  await h.advance(1_000);
  assert.deepEqual(h.sent.slice(2), h.sent.slice(0, 2));
  h.session.dispose();
});

test('polite rollback replays gathered candidates when its answer reuses abandoned offer ICE credentials', async () => {
  const h = harness(); await h.session.negotiate(); await drain();
  const abandoned = h.sent[0].negotiationId;
  h.pc.candidate('offer1'); await drain();
  h.pc.createAnswer = async () => ({ type: 'answer', sdp: 'v=0\r\na=ice-ufrag:offer1\r\n' });
  await h.session.receive({ type: 'offer', negotiationId: 'accepted', sdp: 'v=0\r\na=ice-ufrag:remote\r\n' });
  await drain();
  const replay = h.sent.at(-1);
  assert.equal(replay.type, 'candidate');
  assert.equal(replay.candidate.usernameFragment, 'offer1');
  assert.equal(replay.negotiationId, 'accepted');
  assert.notEqual(replay.negotiationId, abandoned);
  h.session.dispose();
});

test('a received answer does not stop retransmitting lost trickle ICE before the connection is established', async () => {
  const h = harness(); await h.session.negotiate(); await drain();
  h.pc.candidate('offer1'); await drain();
  await h.session.receive(answer(h.sent[0]));
  const before = h.sent.length;
  await h.advance(1_000);
  assert.deepEqual(h.sent.slice(before).map((signal) => signal.type), ['offer', 'candidate']);
  h.pc.state('connected'); const connected = h.sent.length; await h.advance(60_000);
  assert.equal(h.sent.length, connected); assert.equal(h.timers.size, 0); h.session.dispose();
});

test('polite rollback restarts a live audio sender without reopening or stopping the microphone', async () => {
  const replacements = []; const track = { kind: 'audio', readyState: 'live' };
  const sender = { track, async replaceTrack(value) { replacements.push(value); this.track = value; } };
  const pc = new Peer(); pc.getSenders = () => [sender];
  const h = harness({ pc }); await h.session.negotiate();
  await h.session.receive({ type: 'offer', negotiationId: 'accepted', sdp: 'v=0\r\na=ice-ufrag:remote\r\n' });
  assert.deepEqual(replacements, [null, track]); assert.equal(sender.track, track);
  h.session.dispose();
});

test('rollback sender recovery preserves an audio track concurrently installed by the voice processing control', async () => {
  const previous = { kind: 'audio', readyState: 'live' }; const replacement = { kind: 'audio', readyState: 'live' };
  const calls = [];
  const sender = { track: previous, async replaceTrack(value) { calls.push(value); this.track = replacement; } };
  const pc = new Peer(); pc.getSenders = () => [sender];
  const h = harness({ pc }); await h.session.negotiate();
  await h.session.receive({ type: 'offer', negotiationId: 'accepted', sdp: 'v=0\r\na=ice-ufrag:remote\r\n' });
  assert.deepEqual(calls, [null]); assert.equal(sender.track, replacement); h.session.dispose();
});

test('both failure events coalesce into one restart and short disconnections preserve healthy media', async () => {
  const h = harness({ polite: false }); await h.session.negotiate(); await drain(); await h.session.receive(answer(h.sent[0]));
  h.pc.state('connected'); h.pc.state('disconnected'); await h.advance(2_999);
  assert.equal(h.pc.offers.length, 1); h.pc.state('connected'); await h.advance(10_000);
  assert.equal(h.pc.offers.length, 1);
  h.pc.state('failed'); await drain();
  assert.equal(h.pc.offers.length, 2);
  h.session.dispose();
});

test('a persistent disconnection restarts after its grace period', async () => {
  const h = harness({ polite: false }); await h.session.negotiate(); await drain(); await h.session.receive(answer(h.sent[0]));
  h.pc.state('disconnected'); await h.advance(3_000);
  assert.equal(h.pc.offers.length, 2); assert.equal(h.states.at(-1), 'connecting');
  h.session.dispose();
});

test('receiver subscription readiness cannot originate an unsolicited initial offer', async () => {
  const h = harness(); h.session.signalReady(); await drain();
  assert.equal(h.pc.offers.length, 0); assert.equal(h.sent.length, 0);
  h.session.dispose();
});

test('legacy offer/answer and candidate messages remain compatible', async () => {
  const h = harness();
  const legacy = { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:legacy\r\n' };
  await h.session.receive(legacy); await drain();
  assert.equal(h.sent[0].type, 'answer'); assert.equal('negotiationId' in h.sent[0], false);
  await h.session.receive({ type: 'candidate', candidate: { candidate: 'legacy' } });
  assert.equal(h.pc.received.length, 1);
  await h.session.receive(legacy); await drain(); assert.equal(h.pc.answerCount, 1);
  h.session.dispose();
});

test('group renegotiations keep the existing offer/answer event names', async () => {
  const h = harness({ group: true }); await h.session.negotiate(); await drain();
  await h.session.receive(answer(h.sent[0])); await h.session.negotiate(); await drain();
  assert.equal(h.sent.at(-1).type, 'offer'); h.session.dispose();
});

test('simultaneous recovery elects one restart offerer and avoids ICE restart rollback', async () => {
  let a; let b;
  a = harness({ polite: false, send: (signal) => b.session.receive(signal) });
  b = harness({ polite: true, send: (signal) => a.session.receive(signal) });
  await a.session.negotiate(); await drain(); await drain();
  a.pc.state('connected'); b.pc.state('connected');
  await Promise.all([a.session.recover({ force: true }), b.session.recover({ force: true })]);
  await drain(); await drain();
  assert.equal(a.pc.offers.length, 2); assert.equal(b.pc.offers.length, 0);
  assert.equal(a.pc.rollbacks + b.pc.rollbacks, 0);
  assert.equal(a.pc.signalingState, 'stable'); assert.equal(b.pc.signalingState, 'stable');
  a.session.dispose(); b.session.dispose();
});

test('an exhausted pending offer rolls back before a fresh restart and ignores the late old answer', async () => {
  let refreshes = 0;
  const h = harness({ polite: false, prepareRestart: async () => { refreshes += 1; return { iceServers: [] }; } });
  await h.session.negotiate(); await h.advance(90_000);
  const old = h.sent[0];
  await h.session.recover({ force: true }); await drain();
  assert.equal(refreshes, 1); assert.equal(h.pc.rollbacks, 1);
  assert.equal(h.pc.offers.length, 2); assert.deepEqual(h.pc.offers[1], { iceRestart: true });
  const fresh = h.sent.at(-1); assert.notEqual(fresh.negotiationId, old.negotiationId);
  await h.session.receive(answer(old)); assert.equal(h.pc.signalingState, 'have-local-offer');
  await h.session.receive(answer(fresh)); assert.equal(h.pc.signalingState, 'stable');
  h.session.dispose();
});

test('polite peer falls back for older clients that cannot delegate a restart', async () => {
  const h = harness(); await h.session.recover(); await h.advance(7_000);
  assert.equal(h.sent.filter((signal) => signal.type === 'restart-request').length, 4);
  assert.equal(h.pc.offers.length, 1);
  h.session.dispose();
});

test('dispose and replaced call generations prevent deferred work and leave no timers', async () => {
  let resolve; let current = true;
  const h = harness({ polite: false, isCurrent: () => current, prepareRestart: () => new Promise((done) => { resolve = done; }) });
  const restart = h.session.recover(); await drain(); current = false; resolve({ iceServers: [] }); await restart;
  assert.equal(h.pc.offers.length, 0); assert.equal(h.sent.length, 0);
  h.session.dispose(); assert.equal(h.timers.size, 0);
  const pending = harness(); await pending.session.negotiate(); pending.pc.state('disconnected'); pending.session.dispose();
  await pending.advance(90_000); assert.equal(pending.sent.length, 1); assert.equal(pending.timers.size, 0);
});

test('TURN refresh errors never apply an incomplete configuration and retries stop after a bounded budget', async () => {
  const h = harness({ polite: false, prepareRestart: async () => { throw new Error('TURN unavailable'); } });
  await h.session.recover(); await h.advance(90_000);
  assert.equal(h.errors.length, 4); assert.equal(h.pc.offers.length, 0); assert.equal(h.pc.configurations.length, 0);
  assert.equal(h.timers.size, 0); h.session.dispose();
});
