import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCallPeerSession } from '../src/context/calls/callPeerSession.js';

// Substitute only Vite's asset import. The processing and recovery modules run
// together unchanged; media primitives provide controllable operation ordering.
const source = await readFile(new URL('../src/context/calls/voiceEnhancement.js', import.meta.url), 'utf8');
const { VoiceEnhancementPipeline } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
  "import noiseGateWorkletUrl from './noiseGate.worklet.js?url';", "const noiseGateWorkletUrl = 'noise-gate.js';"
)).toString('base64')}`);

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
class Track {
  kind = 'audio';
  readyState = 'live';
  enabled = true;
  stop() { this.readyState = 'ended'; }
}
class Stream {
  constructor(tracks) { this.tracks = [...tracks]; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  removeTrack(track) { this.tracks = this.tracks.filter(item => item !== track); }
  addTrack(track) { if (!this.tracks.includes(track)) this.tracks.push(track); }
}
class Node {
  connect(node) { return node; }
  disconnect() {}
}
class Context {
  state = 'running';
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource() { return new Node(); }
  createMediaStreamDestination() {
    const destination = new Node();
    destination.stream = new Stream([new Track()]);
    return destination;
  }
  async close() { this.state = 'closed'; }
}
class Peer extends EventTarget {
  connectionState = 'connected';
  iceConnectionState = 'connected';
  signalingState = 'stable';
  constructor(sender) { super(); this.sender = sender; }
  getSenders() { return [this.sender]; }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:local\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\na=ice-ufrag:local\r\n' }; }
  async setLocalDescription(description) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
}

function setup(t) {
  for (const [name, value] of Object.entries({
    MediaStream: Stream, AudioContext: Context, BiquadFilterNode: Node,
    DynamicsCompressorNode: Node, AudioWorkletNode: Node
  })) {
    const previous = globalThis[name];
    globalThis[name] = value;
    t.after(() => { if (previous === undefined) delete globalThis[name]; else globalThis[name] = previous; });
  }
  const original = new Track();
  const stream = new Stream([original]);
  const detached = deferred();
  const releaseDetach = deferred();
  const restoring = deferred();
  const releaseRestore = deferred();
  const sender = {
    track: original, replacements: [], holdRestoration: false,
    async replaceTrack(track) {
      this.replacements.push(track);
      if (track === null) {
        this.track = null;
        detached.resolve();
        await releaseDetach.promise;
      } else {
        if (this.holdRestoration && this.track === null) {
          this.holdRestoration = false;
          restoring.resolve();
          await releaseRestore.promise;
        }
        this.track = track;
      }
    }
  };
  const pc = new Peer(sender);
  const pipeline = new VoiceEnhancementPipeline();
  const errors = [];
  const session = createCallPeerSession({
    pc, polite: true, send: () => {}, onError: error => errors.push(error),
    getAudioTrack: () => stream.getAudioTracks()[0]
  });
  t.after(async () => {
    releaseDetach.resolve(); releaseRestore.resolve();
    session.dispose();
    await pipeline.dispose();
  });
  return {
    original, stream, sender, pc, pipeline, session, errors,
    detached, releaseDetach, restoring, releaseRestore,
    async collide() {
      await session.negotiate();
      return session.receive({ type: 'offer', negotiationId: 'collision', sdp: 'v=0\r\na=ice-ufrag:remote\r\n' });
    }
  };
}

test('disabling voice processing while rollback has detached audio restores the live original microphone', { timeout: 2_000 }, async t => {
  const h = setup(t);
  await h.pipeline.enable(h.stream, h.pc, {});
  const processed = h.pipeline.processedTrack;
  const repairing = h.collide();
  await h.detached.promise;
  await h.pipeline.disable(h.pc, {});
  assert.equal(processed.readyState, 'ended');
  assert.equal(h.sender.track, null);
  h.releaseDetach.resolve();
  await repairing;
  assert.equal(h.sender.track, h.original);
  assert.equal(h.sender.track.readyState, 'live');
  assert.equal(h.pipeline.active, false);
  assert.equal(h.pc.signalingState, 'stable');
  assert.deepEqual(h.errors, []);
});

test('enabling voice processing while rollback has detached audio restores the current processed microphone', { timeout: 2_000 }, async t => {
  const h = setup(t);
  const repairing = h.collide();
  await h.detached.promise;
  await h.pipeline.enable(h.stream, h.pc, {});
  const processed = h.pipeline.processedTrack;
  assert.equal(h.sender.track, null);
  h.releaseDetach.resolve();
  await repairing;
  assert.equal(h.sender.track, processed);
  assert.equal(h.sender.track.readyState, 'live');
  assert.equal(h.pipeline.active, true);
  assert.deepEqual(h.errors, []);
  await h.pipeline.disable(h.pc, {});
  assert.equal(h.sender.track, h.original);
});

test('rollback preserves an external replacement installed while voice processing is disabled', { timeout: 2_000 }, async t => {
  const h = setup(t);
  await h.pipeline.enable(h.stream, h.pc, {});
  const processed = h.pipeline.processedTrack;
  const repairing = h.collide();
  await h.detached.promise;
  await h.pipeline.disable(h.pc, {});
  await h.sender.replaceTrack(h.original);
  h.releaseDetach.resolve();
  await repairing;
  assert.equal(h.sender.track, h.original);
  assert.deepEqual(h.sender.replacements, [processed, null, h.original]);
  assert.deepEqual(h.errors, []);
});

test('disabling voice processing during pending rollback restoration cannot leave an ended processed sender', { timeout: 2_000 }, async t => {
  const h = setup(t);
  await h.pipeline.enable(h.stream, h.pc, {});
  const processed = h.pipeline.processedTrack;
  h.sender.holdRestoration = true;
  const repairing = h.collide();
  await h.detached.promise;
  h.releaseDetach.resolve();
  await h.restoring.promise;
  await h.pipeline.disable(h.pc, {});
  assert.equal(processed.readyState, 'ended');
  h.releaseRestore.resolve();
  await repairing;
  assert.equal(h.sender.track, h.original);
  assert.equal(h.sender.track.readyState, 'live');
  assert.equal(h.pipeline.active, false);
  assert.deepEqual(h.errors, []);
});
