import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as mediaHelpers from '../src/context/calls/mediaTrackHelpers.js';

// Run the production hook body with deterministic React hook primitives. The
// native browser fixture separately verifies capture and actual RTP behavior.
const source = await readFile(new URL('../src/context/calls/useCallMedia.js', import.meta.url), 'utf8');
const defer = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function stream() {
  const track = { kind: 'video', readyState: 'live', stop() { this.readyState = 'ended'; } };
  return { getTracks: () => [track], getVideoTracks: () => [track], track };
}
function peer() {
  const senders = [];
  return {
    senders,
    getSenders: () => senders,
    addTrack(track) { const sender = { track, async replaceTrack(next) { this.track = next; } }; senders.push(sender); return sender; },
    removeTrack(sender) { senders.splice(senders.indexOf(sender), 1); }
  };
}
function setup(t, group = false) {
  const refs = [];
  const cleanups = [];
  let cursor = 0;
  const hooks = {
    useRef(value) { return refs[cursor++] ?? (refs[cursor - 1] = { current: value }); },
    useCallback(callback) { return callback; },
    useEffect(callback) { if (!cleanups.length) cleanups.push(callback()); }
  };
  // Keep imports explicit so errors in the real hook still fail these tests.
  const body = source.replace(/^import .*;\n/gm, '').replace('export function useCallMedia', 'function useCallMedia');
  const load = new Function('hooks', 'helpers', `const { useRef, useCallback, useEffect } = hooks;
    const { removeVideoSender, replaceOrAddVideoTrack, stopStreamTracks } = helpers;
    ${body}; return useCallMedia;`);
  const runMediaHook = load(hooks, mediaHelpers);
  const camera = [], display = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia() { const request = defer(); camera.push(request); return request.promise; },
    getDisplayMedia() { const request = defer(); display.push(request); return request.promise; }
  } } });
  t.after(() => { cleanups.forEach(cleanup => cleanup?.());
    if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
  let renegotiations = 0;
  const states = [];
  const signals = [];
  const pc = peer();
  const options = {
    callState: { status: 'connected', callId: 'first', chatId: 'chat' }, currentUser: { id: 'A' },
    chats: [{ id: 'chat', type: group ? 'group' : 'personal' }],
    localVideoStreamRef: { current: null }, screenStreamRef: { current: null }, wasCameraActiveRef: { current: false },
    pcRef: { current: pc }, pcsRef: { current: group ? { B: pc, C: peer() } : {} },
    activeCallChannelRef: { current: { async send(message) { signals.push(message); return 'ok'; } } },
    mediaGenerationRef: { current: 1 }, callStateRef: { current: null },
    setLocalVideoStream(value) { states.push(value); }, setIsScreenSharing() {}, setMediaError() {},
    async renegotiateMedia() { renegotiations++; }
  };
  options.callStateRef.current = options.callState;
  const render = () => { cursor = 0; return runMediaHook(options); };
  const end = () => { options.mediaGenerationRef.current++; options.callStateRef.current = { ...options.callState, status: 'ended' }; };
  return { options, render, camera, display, states, signals, pc, end, cleanups, get renegotiations() { return renegotiations; } };
}
for (const kind of ['camera', 'display']) test(`late ${kind} permission after immediate hangup stops the granted stream`, async t => {
  const h = setup(t);
  const api = h.render();
  const pending = kind === 'camera' ? api.toggleCallVideo() : api.toggleCallScreenShare();
  const request = kind === 'camera' ? h.camera[0] : h.display[0];
  h.end(); // No React rerender between hangup and the permission result.
  const captured = stream();
  request.resolve(captured);
  await pending;
  assert.equal(captured.track.readyState, 'ended');
  assert.equal(h.options.localVideoStreamRef.current, null);
  assert.equal(h.pc.senders.length, 0);
  assert.equal(h.renegotiations, 0);
  assert.deepEqual(h.states, []);
});

test('an old camera grant cannot replace media belonging to a new call', async t => {
  const h = setup(t);
  const pending = h.render().toggleCallVideo();
  h.end();
  h.options.callState = { ...h.options.callState, callId: 'second' };
  h.options.callStateRef.current = h.options.callState;
  const newer = stream();
  h.options.localVideoStreamRef.current = newer;
  h.render();
  const stale = stream();
  h.camera[0].resolve(stale);
  await pending;
  assert.equal(stale.track.readyState, 'ended');
  assert.equal(newer.track.readyState, 'live');
  assert.equal(h.options.localVideoStreamRef.current, newer);
});

test('unmount cancels a pending display permission', async t => {
  const h = setup(t);
  const pending = h.render().toggleCallScreenShare();
  h.cleanups.forEach(cleanup => cleanup?.());
  const captured = stream();
  h.display[0].resolve(captured);
  await pending;
  assert.equal(captured.track.readyState, 'ended');
  assert.deepEqual(h.states, []);
});

test('canceling the display picker preserves the existing camera without another permission prompt', async t => {
  const h = setup(t);
  const existing = stream();
  h.options.localVideoStreamRef.current = existing;
  h.pc.addTrack(existing.track);
  const pending = h.render().toggleCallScreenShare();
  h.display[0].reject(new Error('Permission denied'));
  await pending;
  assert.equal(existing.track.readyState, 'live');
  assert.equal(h.options.localVideoStreamRef.current, existing);
  assert.equal(h.pc.senders[0].track, existing.track);
  assert.equal(h.camera.length, 0);
});

test('superseded camera grants cannot overwrite the latest capture', async t => {
  const h = setup(t);
  const api = h.render();
  const first = api.toggleCallVideo();
  const second = api.toggleCallVideo();
  const newer = stream();
  h.camera[1].resolve(newer);
  await second;
  const stale = stream();
  h.camera[0].resolve(stale);
  await first;
  assert.equal(stale.track.readyState, 'ended');
  assert.equal(h.pc.senders[0].track, newer.track);
  assert.equal(h.options.localVideoStreamRef.current, newer);
});

test('partial group display replacement restores the camera for every sender', async t => {
  const h = setup(t, true);
  const camera = stream();
  h.options.localVideoStreamRef.current = camera;
  for (const pc of Object.values(h.options.pcsRef.current)) pc.addTrack(camera.track);
  const rejected = stream();
  const secondSender = h.options.pcsRef.current.C.senders[0];
  secondSender.replaceTrack = async function(next) { if (next === rejected.track) throw new Error('Replace failed'); this.track = next; };
  const pending = h.render().toggleCallScreenShare();
  h.display[0].resolve(rejected);
  await pending;
  assert.equal(rejected.track.readyState, 'ended');
  assert.equal(camera.track.readyState, 'live');
  assert.equal(h.options.localVideoStreamRef.current, camera);
  for (const pc of Object.values(h.options.pcsRef.current)) assert.equal(pc.senders[0].track, camera.track);
});

test('group camera stop addresses every active peer before renegotiating', async t => {
  const h = setup(t, true);
  const camera = stream();
  h.options.localVideoStreamRef.current = camera;
  for (const pc of Object.values(h.options.pcsRef.current)) pc.addTrack(camera.track);
  await h.render().toggleCallVideo();
  assert.deepEqual(h.signals.map(signal => signal.payload), ['B', 'C'].map(targetId => ({
    type: 'video-stopped', callId: 'first', senderId: 'A', targetId
  })));
  assert.equal(camera.track.readyState, 'ended');
  assert.equal(h.renegotiations, 1);
  for (const pc of Object.values(h.options.pcsRef.current)) assert.equal(pc.senders.length, 0);
});

test('the camera action replaces a live display only after camera permission succeeds', async t => {
  const h = setup(t);
  const display = stream();
  h.options.localVideoStreamRef.current = display;
  h.options.screenStreamRef.current = display;
  h.options.wasCameraActiveRef.current = true;
  h.pc.addTrack(display.track);
  const pending = h.render().toggleCallVideo();
  assert.equal(h.camera.length, 1);
  assert.equal(display.track.readyState, 'live');
  assert.equal(h.options.screenStreamRef.current, display);
  const camera = stream();
  h.camera[0].resolve(camera);
  await pending;
  assert.equal(h.options.localVideoStreamRef.current, camera);
  assert.equal(h.options.screenStreamRef.current, null);
  assert.equal(h.pc.senders[0].track, camera.track);
  assert.equal(display.track.readyState, 'ended');
  assert.equal(h.options.wasCameraActiveRef.current, false);
});

test('denied camera permission keeps the working display and its sender', async t => {
  const h = setup(t);
  const display = stream();
  h.options.localVideoStreamRef.current = display;
  h.options.screenStreamRef.current = display;
  h.pc.addTrack(display.track);
  const pending = h.render().toggleCallVideo();
  h.camera[0].reject(new Error('Permission denied'));
  await pending;
  assert.equal(h.options.localVideoStreamRef.current, display);
  assert.equal(h.options.screenStreamRef.current, display);
  assert.equal(h.pc.senders[0].track, display.track);
  assert.equal(display.track.readyState, 'live');
});

test('a group peer joining during display replacement receives the current live track', async t => {
  const h = setup(t, true);
  delete h.options.pcsRef.current.C;
  const camera = stream();
  h.options.localVideoStreamRef.current = camera;
  const sender = h.pc.addTrack(camera.track);
  const replacement = defer();
  sender.replaceTrack = async function(track) { this.track = track; await replacement.promise; };
  const pending = h.render().toggleCallScreenShare();
  const display = stream();
  h.display[0].resolve(display);
  await new Promise(resolve => setImmediate(resolve));
  const joiningPeer = peer();
  joiningPeer.addTrack(camera.track);
  h.options.pcsRef.current.C = joiningPeer;
  replacement.resolve();
  await pending;
  assert.equal(camera.track.readyState, 'ended');
  for (const pc of Object.values(h.options.pcsRef.current)) {
    assert.equal(pc.senders[0].track, display.track);
    assert.equal(pc.senders[0].track.readyState, 'live');
  }
});

test('native display stop during pending negotiation clears display and restores the camera', async t => {
  const h = setup(t);
  const camera = stream();
  h.options.localVideoStreamRef.current = camera;
  h.pc.addTrack(camera.track);
  const negotiation = defer();
  let renegotiations = 0;
  h.options.renegotiateMedia = () => ++renegotiations === 1 ? negotiation.promise : Promise.resolve();
  const pending = h.render().toggleCallScreenShare();
  const display = stream();
  h.display[0].resolve(display);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof display.track.onended, 'function');
  display.track.readyState = 'ended';
  display.track.onended();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.options.screenStreamRef.current, null);
  assert.equal(h.camera.length, 1);
  const restored = stream();
  h.camera[0].resolve(restored);
  await new Promise(resolve => setImmediate(resolve));
  negotiation.resolve();
  await pending;
  assert.equal(h.options.localVideoStreamRef.current, restored);
  assert.equal(h.pc.senders[0].track, restored.track);
  assert.equal(restored.track.readyState, 'live');
});
