import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mediaPlayers = readFileSync(new URL('../src/components/chat/mediaPlayers.jsx', import.meta.url), 'utf8');
const imageViewer = readFileSync(new URL('../src/components/chat/ImageViewer.jsx', import.meta.url), 'utf8');
const chatAreaCss = readFileSync(new URL('../src/components/chat/ImageViewer.css', import.meta.url), 'utf8');
const chatSources = [mediaPlayers, imageViewer].join('\n');

// Scroll-following for incoming messages: tests/scrollStability.test.mjs.

test('chat images open in an in-app viewer', () => {
  // Opening the viewer from a message is exercised in tests/ui/*interface*.spec.mjs.
  assert.match(chatSources, /className="chat-image-viewer"/);
  assert.match(chatAreaCss, /\.chat-image-viewer\s*\{/);
});

test('round video messages stop when playback reaches the end', () => {
  const playerStart = mediaPlayers.indexOf('function VideoMessagePlayer');
  const playerEnd = mediaPlayers.indexOf('function RegularVideoPlayer', playerStart);
  const player = mediaPlayers.slice(playerStart, playerEnd === -1 ? undefined : playerEnd);
  assert.doesNotMatch(player, /\sloop(?:\s|=)/);
  // Ring completion and replay are checked with actual playback in video-note-progress.spec.mjs.
  assert.match(player, /setHasEnded\(true\)/);
});
