import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const callOverlay = await readFile(new URL('../src/components/call/CallOverlay.jsx', import.meta.url), 'utf8');
const callOverlayCss = await readFile(new URL('../src/components/call/CallOverlay.css', import.meta.url), 'utf8');
const callProvider = await readFile(new URL('../src/context/calls/CallProvider.jsx', import.meta.url), 'utf8');
const callMedia = await readFile(new URL('../src/context/calls/useCallMedia.js', import.meta.url), 'utf8');
const chatHeader = await readFile(new URL('../src/components/chat/ChatHeader.jsx', import.meta.url), 'utf8');
const callSounds = await readFile(new URL('../src/utils/callSounds.js', import.meta.url), 'utf8');
const callChrome = await readFile(new URL('../src/components/call/useCallCardChrome.js', import.meta.url), 'utf8');
const callPip = await readFile(new URL('../src/components/call/useCallLocalPreviewDrag.js', import.meta.url), 'utf8');
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const stableExport = await readFile(new URL('../src/components/CallOverlay.jsx', import.meta.url), 'utf8');

test('ChatHeader has info action only — call entry stays in ChatInfo', () => {
  assert.match(chatHeader, /label="Информация"/);
  assert.doesNotMatch(chatHeader, /title="Звонок"/);
  assert.doesNotMatch(chatHeader, /startCall/);
  assert.doesNotMatch(chatHeader, /useCalls/);
  assert.doesNotMatch(chatHeader, /from 'lucide-react'[\s\S]*Phone|Phone[\s\S]*from 'lucide-react'/);
  assert.match(chatHeader, /showE2eeLock/);
  assert.match(chatHeader, /requiresPersonalE2EE/);
});

test('V5: call stack has no alert(); mediaError surface exists', () => {
  assert.doesNotMatch(callProvider, /\balert\s*\(/);
  assert.doesNotMatch(callMedia, /\balert\s*\(/);
  assert.match(callProvider, /mediaError/);
  assert.match(callProvider, /setMediaError/);
  assert.match(callProvider, /clearMediaError/);
  assert.match(callOverlay, /call-media-error/);
  assert.match(callOverlay, /mediaError/);
});

test('V6: Escape handler and dialog semantics for incoming', () => {
  assert.match(callOverlay, /Escape/);
  assert.match(callOverlay, /rejectCall\(\)/);
  assert.match(callOverlay, /role:\s*'dialog'/);
  assert.match(callOverlay, /aria-modal/);
  assert.match(callOverlay, /acceptBtnRef/);
});

test('C9: duration tick is local elapsed, not setCallState', () => {
  assert.match(callOverlay, /setElapsed/);
  assert.match(callOverlay, /formatTime\(elapsed\)/);
  assert.doesNotMatch(callOverlay, /duration:\s*prev\.duration\s*\+\s*1/);
  assert.doesNotMatch(callOverlay, /setCallState\(prev\s*=>\s*\(\{\s*\.\.\.prev,\s*duration/);
});

test('C10: CallOverlay uses extracted chrome, pip, and callSounds', () => {
  assert.match(callOverlay, /useCallCardChrome/);
  assert.match(callOverlay, /useCallLocalPreviewDrag/);
  assert.match(callOverlay, /from '\.\.\/\.\.\/utils\/callSounds'/);
  assert.match(callSounds, /export function playCallConnect/);
  assert.match(callSounds, /export function startCallRingback/);
  assert.match(callChrome, /export function useCallCardChrome/);
  assert.match(callPip, /export function useCallLocalPreviewDrag/);
  assert.match(stableExport, /from '\.\/call\/CallOverlay'/);
});

test('V3: call video / pulse styles live in CallOverlay.css', () => {
  assert.match(callOverlayCss, /\.remote-video-feed/);
  assert.match(callOverlayCss, /\.local-video-preview/);
  assert.match(callOverlayCss, /\.local-video-feed\.is-camera/);
  assert.match(callOverlayCss, /@keyframes bubblePulse/);
  assert.match(callOverlayCss, /@keyframes active-speaker-pulse/);
  assert.doesNotMatch(indexCss, /\.remote-video-feed\s*\{/);
  assert.doesNotMatch(indexCss, /\.local-video-feed\.is-camera/);
});

test('call video elements rebind their streams after the overlay is restored', () => {
  assert.match(callOverlay, /\[localVideoStream, isMinimized\]/);
  assert.match(callOverlay, /\[remoteVideoStream, isMinimized\]/);
  assert.match(callOverlay, /srcObject = localVideoStream;[\s\S]*?\.play\(\)\.catch/);
  assert.match(callOverlay, /srcObject = remoteVideoStream;[\s\S]*?\.play\(\)\.catch/);
});
