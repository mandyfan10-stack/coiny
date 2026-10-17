import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Only Vite's asset URL import is substituted; all pipeline logic runs unchanged.
const source = await readFile(new URL('../src/context/calls/voiceEnhancement.js', import.meta.url), 'utf8');
const { VoiceEnhancementPipeline } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
  "import noiseGateWorkletUrl from './noiseGate.worklet.js?url';", "const noiseGateWorkletUrl = 'noise-gate.js';"
)).toString('base64')}`);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class Track {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  stop() { this.readyState = 'ended'; }
}
class Stream {
  constructor(tracks) { this.tracks = [...tracks]; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  removeTrack(track) { this.tracks = this.tracks.filter(candidate => candidate !== track); }
  addTrack(track) { if (!this.tracks.includes(track)) this.tracks.push(track); }
}
class Node {
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
}

function setup(t, { moduleReady = Promise.resolve() } = {}) {
  const contexts = [];
  class Context {
    state = 'running';
    audioWorklet = { addModule: () => moduleReady };
    constructor() { contexts.push(this); }
    createMediaStreamSource() { return new Node(); }
    createMediaStreamDestination() {
      this.output = new Track();
      const destination = new Node();
      destination.stream = new Stream([this.output]);
      return destination;
    }
    async close() { this.state = 'closed'; }
  }
  const globals = { AudioContext: Context, MediaStream: Stream, BiquadFilterNode: Node, DynamicsCompressorNode: Node, AudioWorkletNode: Node };
  for (const [key, value] of Object.entries(globals)) {
    const previous = globalThis[key];
    globalThis[key] = value;
    t.after(() => { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
  }
  const original = new Track();
  const stream = new Stream([original]);
  const pipeline = new VoiceEnhancementPipeline();
  t.after(() => pipeline.dispose());
  return { original, stream, pipeline, contexts };
}

function peer(track, behavior = async () => {}) {
  const sender = {
    track,
    replacements: [],
    async replaceTrack(next) {
      this.replacements.push(next);
      await behavior(next, this.replacements.length);
      this.track = next;
    }
  };
  return { connectionState: 'connected', getSenders: () => [sender], sender };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Operation did not reach expected state');
}

test('partial enable rolls back every successful sender before closing the graph', async t => {
  const { original, stream, pipeline, contexts } = setup(t);
  const first = peer(original);
  const slow = deferred();
  const second = peer(original, async next => { if (next !== original) await slow.promise; });
  const third = peer(original, async () => { throw new Error('replace failed'); });
  const enabling = pipeline.enable(stream, first, { second, third });
  const failed = assert.rejects(enabling, /replace failed/);
  await until(() => contexts[0]?.output && first.sender.track !== original);
  assert.equal(contexts[0].state, 'running');
  slow.resolve();
  await failed;
  assert.equal(first.sender.track, original);
  assert.equal(second.sender.track, original);
  assert.equal(pipeline.active, false);
  assert.equal(contexts[0].output.readyState, 'ended');
  assert.equal(contexts[0].state, 'closed');
  assert.equal(original.readyState, 'live');
  assert.deepEqual(stream.getAudioTracks(), [original]);
});

test('failed enable rollback retains processing used by a sender, supports mute and a later disable', async t => {
  const { original, stream, pipeline, contexts } = setup(t);
  const first = peer(original, async (_next, count) => { if (count === 2) throw new Error('rollback failed'); });
  const second = peer(original, async (_next, count) => { if (count === 1) throw new Error('enable failed'); });
  await assert.rejects(pipeline.enable(stream, first, { second }), /enable failed/);
  const processed = contexts[0].output;
  assert.equal(first.sender.track, processed);
  assert.equal(second.sender.track, original);
  assert.equal(processed.readyState, 'live');
  assert.equal(contexts[0].state, 'running');
  assert.equal(pipeline.active, true);
  assert.deepEqual(stream.getAudioTracks(), [processed]);
  pipeline.setMuted(true);
  assert.equal(processed.enabled, false);
  assert.equal(original.enabled, false);
  await pipeline.disable(first, { second });
  assert.equal(first.sender.track, original);
  assert.equal(second.sender.track, original);
  assert.equal(original.enabled, false);
  assert.equal(pipeline.active, false);
});

test('partial disable rolls changed senders back and keeps graph alive', async t => {
  const { original, stream, pipeline, contexts } = setup(t);
  const first = peer(original);
  const second = peer(original, async (_next, count) => { if (count === 2) throw new Error('disable failed'); });
  await pipeline.enable(stream, first, { second });
  const processed = pipeline.processedTrack;
  await assert.rejects(pipeline.disable(first, { second }), /disable failed/);
  assert.equal(first.sender.track, processed);
  assert.equal(second.sender.track, processed);
  assert.equal(processed.readyState, 'live');
  assert.equal(contexts[0].state, 'running');
  assert.equal(pipeline.active, true);
  assert.deepEqual(stream.getAudioTracks(), [processed]);
  await pipeline.disable(first, { second });
  assert.equal(first.sender.track, original);
  assert.equal(second.sender.track, original);
  assert.equal(processed.readyState, 'ended');
});

test('failed disable rollback keeps both audio paths live until retry or call end', async t => {
  const { original, stream, pipeline, contexts } = setup(t);
  const first = peer(original, async (_next, count) => { if (count === 3) throw new Error('rollback failed'); });
  const second = peer(original, async (_next, count) => { if (count === 2) throw new Error('disable failed'); });
  await pipeline.enable(stream, first, { second });
  const processed = pipeline.processedTrack;
  await assert.rejects(pipeline.disable(first, { second }), /disable failed/);
  assert.equal(first.sender.track, original);
  assert.equal(second.sender.track, processed);
  pipeline.setMuted(true);
  assert.equal(original.enabled, false);
  assert.equal(processed.enabled, false);
  pipeline.setMuted(false);
  assert.equal(original.enabled, true);
  assert.equal(processed.enabled, true);
  assert.equal(contexts[0].state, 'running');
  await pipeline.dispose();
  assert.equal(original.readyState, 'ended');
  assert.equal(processed.readyState, 'ended');
});

test('concurrent enables and disable are serialized and preserve mute changed during await', async t => {
  const pending = deferred();
  const { original, stream, pipeline, contexts } = setup(t);
  const connection = peer(original, async (_next, count) => { if (count === 1) await pending.promise; });
  const enable = pipeline.enable(stream, connection);
  const duplicate = pipeline.enable(stream, connection);
  const disable = pipeline.disable(connection);
  await until(() => connection.sender.replacements.length === 1);
  pipeline.setMuted(true);
  pending.resolve();
  await Promise.all([enable, duplicate, disable]);
  assert.equal(contexts.length, 1);
  assert.equal(connection.sender.replacements.length, 2);
  assert.equal(connection.sender.track, original);
  assert.equal(original.enabled, false);
  assert.equal(pipeline.active, false);
});

test('dispose during worklet loading cancels enable and does not affect the next call', async t => {
  const pending = deferred();
  const { original, stream, pipeline, contexts } = setup(t, { moduleReady: pending.promise });
  const connection = peer(original);
  const enable = pipeline.enable(stream, connection);
  const aborted = assert.rejects(enable, { name: 'AbortError' });
  await until(() => contexts.length === 1);
  await pipeline.dispose();
  assert.equal(original.readyState, 'ended');
  const nextOriginal = new Track();
  const nextStream = new Stream([nextOriginal]);
  const nextPeer = peer(nextOriginal);
  const nextEnable = pipeline.enable(nextStream, nextPeer);
  pending.resolve();
  await aborted;
  await nextEnable;
  assert.equal(pipeline.active, true);
  assert.equal(pipeline.originalTrack, nextOriginal);
  assert.equal(nextOriginal.readyState, 'live');
  assert.equal(connection.sender.replacements.length, 0);
});

test('dispose during pending replacements stops hidden microphone and rejects queued toggles', async t => {
  const pending = deferred();
  const { original, stream, pipeline, contexts } = setup(t);
  const connection = peer(original, async () => pending.promise);
  const enable = pipeline.enable(stream, connection);
  const abortedEnable = assert.rejects(enable, { name: 'AbortError' });
  const disable = pipeline.disable(connection);
  const abortedDisable = assert.rejects(disable, { name: 'AbortError' });
  await until(() => connection.sender.replacements.length === 1);
  await pipeline.dispose();
  assert.equal(original.readyState, 'ended');
  assert.equal(contexts[0].output.readyState, 'ended');
  connection.connectionState = 'closed';
  pending.resolve();
  await Promise.all([abortedEnable, abortedDisable]);
  assert.equal(pipeline.active, false);
  assert.equal(connection.sender.replacements.length, 1);
});

test('closed peers do not break disable and dispose never replaces tracks', async t => {
  const { original, stream, pipeline } = setup(t);
  const connection = peer(original);
  await pipeline.enable(stream, connection);
  connection.connectionState = 'closed';
  await pipeline.disable(connection);
  assert.equal(connection.sender.replacements.length, 1);
  await pipeline.dispose(connection);
  assert.equal(connection.sender.replacements.length, 1);
});

test('a peer joining during disable is switched before the shared processed graph closes', async t => {
  const { original, stream, pipeline, contexts } = setup(t);
  const pending = deferred();
  const first = peer(original, async (_next, count) => { if (count === 2) await pending.promise; });
  const mesh = {};
  await pipeline.enable(stream, first, mesh);
  const processed = pipeline.processedTrack;
  const disabling = pipeline.disable(first, mesh);
  await until(() => first.sender.replacements.length === 2);
  const joining = peer(processed);
  mesh.joining = joining;
  pending.resolve();
  await disabling;
  assert.equal(joining.sender.track, original);
  assert.equal(joining.sender.track.readyState, 'live');
  assert.equal(contexts[0].state, 'closed');
});

test('synchronous replaceTrack errors also wait for successful peers and roll back', async t => {
  const { original, stream, pipeline } = setup(t);
  const first = peer(original);
  const second = { getSenders: () => [{ track: original, replaceTrack() { throw new Error('synchronous failure'); } }] };
  await assert.rejects(pipeline.enable(stream, first, { second }), /synchronous failure/);
  assert.equal(first.sender.track, original);
  assert.equal(pipeline.active, false);
});

test('enabling while muted can unmute both the worklet input and outgoing track', async t => {
  const { original, stream, pipeline } = setup(t);
  original.enabled = false;
  const connection = peer(original);
  await pipeline.enable(stream, connection);
  assert.equal(pipeline.processedTrack.enabled, false);
  pipeline.setMuted(false);
  assert.equal(original.enabled, true);
  assert.equal(connection.sender.track.enabled, true);
  await pipeline.disable(connection);
  assert.equal(connection.sender.track, original);
  assert.equal(original.enabled, true);
});
