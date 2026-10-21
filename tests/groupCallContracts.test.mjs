import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { constants as fsConstants } from 'node:fs';

const callProvider = await readFile(new URL('../src/context/calls/CallProvider.jsx', import.meta.url), 'utf8');
const callMedia = await readFile(new URL('../src/context/calls/useCallMedia.js', import.meta.url), 'utf8');
const callSignaling = await readFile(new URL('../src/context/calls/useCallSignaling.js', import.meta.url), 'utf8');
const callOverlay = await readFile(new URL('../src/components/call/CallOverlay.jsx', import.meta.url), 'utf8');
const callOverlayCss = await readFile(new URL('../src/components/call/CallOverlay.css', import.meta.url), 'utf8');
const callTransport = await readFile(new URL('../src/context/calls/useCallTransport.js', import.meta.url), 'utf8');
const callSources = [callProvider, callMedia, callSignaling, callTransport].join('\n');

// Behavioral coverage uses actual peer sessions in callPeerSession.test.mjs and
// actual providers with native ICE/DTLS/RTP in ui/call-transport.spec.mjs.
test('group discovery and addressed signaling share one session per peer', () => {
  assert.match(callTransport, /const existing = sessions.get\(id\)/);
  assert.match(callTransport, /event: 'join-group-call'/);
  assert.match(callTransport, /payload.targetId !== selfId \|\| !isMember\(id\)/);
  assert.match(callTransport, /else await engine.receive\(payload\)/);
});

test('new group peers receive the live camera or screen track', () => {
  assert.match(callTransport, /localVideoStreamRef.current\?\.getVideoTracks\(\).filter\(track => track.readyState === 'live'\)/);
  assert.match(callTransport, /pc.addTrack\(track, refs.localVideoStreamRef.current\)/);
});

test('camera and screen replacement finish before the shared renegotiation', () => {
  assert.doesNotMatch(callSources, /forEach\(async/);
  assert.match(callMedia, /for \(const pc of targets\)/);
  assert.match(callMedia, /await replaceOrAddVideoTrack\(pc, videoTrack, stream\)/);
  assert.match(callMedia, /await renegotiateMedia\?\.\(\)/);
  assert.doesNotMatch(callMedia, /createOffer|setLocalDescription/);
});

test('group presence reconciles peers without tearing down healthy media', () => {
  assert.match(callTransport, /presence: \{ key: selfId \}/);
  assert.match(callTransport, /channel.presenceState\(\)/);
  assert.match(callTransport, /await channel.track\(/);
  assert.match(callTransport, /markMissing\(id\)/);
  assert.match(callTransport, /15_000/);
  assert.match(callTransport, /pc.connectionState !== 'connected'\) removePeer\(id\)/);
});

test('call metadata is resolved from the call chat instead of the open chat', () => {
  assert.match(callProvider, /const callChat = chats.find\(c => c.id === callState.chatId\)/);
  assert.match(callTransport, /latest.current.callChatRef.current\?\.members/);
  assert.doesNotMatch(callSources, /activeChatRef/);
});

test('endCallLocally only idles when status is still ended (C1)', () => {
  assert.match(callProvider, /prev\.status === 'ended'\s*\?\s*\{\s*\.\.\.IDLE_CALL_STATE\s*\}/);
  assert.match(callProvider, /const teardownMedia = useCallback/);
});

test('incoming-call is ignored while already busy (C2)', () => {
  assert.match(callSignaling, /BUSY_CALL_STATUSES/);
  assert.match(callSignaling, /BUSY_CALL_STATUSES\.has\(prev\.status\)/);
  assert.match(callSignaling, /onRemoteEnd/);
});

test('call signaling subscriptions stay stable across ordinary context rerenders', () => {
  assert.match(callProvider, /signalingChannelKey[\s\S]*chat\.cryptoVersion/);
  assert.match(callSignaling, /const chatsRef = useRef\(chats\)/);
  assert.match(callSignaling, /encryptEventRef\.current\(\.\.\.args\)/);
  assert.match(callSignaling, /decryptEventRef\.current\(\.\.\.args\)/);
  assert.match(callSignaling, /\[currentUserId, signalingChannelKey, setCallState, acceptedIsCurrent, terminalIsCurrent\]/);
  assert.doesNotMatch(callSignaling, /\[currentUserId,[^\]]*\bchats\b/);
});

test('1:1 screen share triggers renegotiation after track replace (C3)', () => {
  assert.match(callMedia, /await activate\(stream, token, true\)/);
  assert.match(callMedia, /await replaceOrAddVideoTrack[\s\S]*await triggerRenegotiation\(\)/);
});

test('WebRTC effect cleanup tears down group peers and analyzers (C4)', () => {
  assert.match(callTransport, /active = false/);
  assert.match(callTransport, /session.*dispose|engine.dispose/);
  assert.match(callTransport, /teardownMedia\(\)/);
  assert.match(callProvider, /teardownMedia\(\)/);
  assert.match(callProvider, /pcsRef\.current\[peerId\]\?\.close/);
  assert.match(callProvider, /audioAnalyzersRef\.current\[key\]\?\.stop/);
});

test('dead useCallWebRtc extract is removed (C5)', async () => {
  await assert.rejects(
    () => access(new URL('../src/context/calls/useCallWebRtc.js', import.meta.url), fsConstants.F_OK),
    (err) => err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')
  );
  assert.doesNotMatch(callProvider, /useCallWebRtc/);
});

test('group UI keeps participant and video controls (C6)', () => {
  assert.match(callOverlay, /isGroupCall/);
  assert.match(callOverlay, /showVideoControls/);
  assert.match(callOverlay, /p\.cameraStream/);
  assert.match(callOverlay, /p\.screenStream/);
});

test('ICE failure exposes retry path and clearer copy (C7)', () => {
  assert.match(callProvider, /retryCallConnection/);
  assert.match(callProvider, /session.recover\(\{ force: true \}\)/);
  assert.match(callOverlay, /Нет WebRTC-связи/);
  assert.match(callOverlay, /retryCallConnection/);
});

test('ring timeout auto-ends unanswered calls (C8)', () => {
  assert.match(callProvider, /CALL_RING_TIMEOUT_MS/);
  assert.match(callProvider, /60_000|60000/);
  assert.match(callProvider, /callState\.status !== 'calling' && callState\.status !== 'incoming'/);
});

test('compact call overlay and unmirrored screen preview (V1/V2)', () => {
  assert.match(callOverlay, /isCompact|getIsCompactViewport/);
  assert.match(callOverlayCss, /safe-area-inset/);
  assert.match(callOverlayCss, /@media \(max-width: 480px\)/);
  assert.match(callOverlay, /is-camera|is-screen/);
  assert.match(callOverlayCss, /\.local-video-feed\.is-camera/);
  assert.match(callOverlayCss, /\.local-video-feed\.is-screen/);
});

test('media lifetime depends on call identity and uses current crypto callbacks', () => {
  assert.match(callTransport, /\[status, callId, userId, teardownMedia, endCallLocally\]/);
  assert.match(callTransport, /latest.current.encryptEvent\(\.\.\.args\)/);
  assert.match(callTransport, /latest.current.decryptEvent\(\.\.\.args\)/);
  assert.doesNotMatch(callTransport, /console\.(log|warn|error)/);
});

test('audio analyzer lifecycle stops prior instances and handles ended tracks', () => {
  assert.match(callTransport, /audioAnalyzersRef.current\[key\]\?\.stop\(\)/);
  assert.match(callTransport, /track.onended/);
  assert.match(callTransport, /element.srcObject = null/);
});
