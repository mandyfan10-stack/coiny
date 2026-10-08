import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatArea = readFileSync(new URL('../src/components/ChatArea.jsx', import.meta.url), 'utf8');
const mediaPlayers = readFileSync(new URL('../src/components/chat/mediaPlayers.jsx', import.meta.url), 'utf8');
const imageViewer = readFileSync(new URL('../src/components/chat/ImageViewer.jsx', import.meta.url), 'utf8');
const chatAreaCss = readFileSync(new URL('../src/components/chat/ImageViewer.css', import.meta.url), 'utf8');
const chatSources = [chatArea, mediaPlayers, imageViewer].join('\n');

test('incoming messages preserve the reader scroll position away from the bottom', () => {
  assert.match(chatArea, /distanceFromBottom < 120/);
  assert.match(chatArea, /shouldAutoScrollRef\.current \|\| isOwnMessage/);
});

test('chat images open in an in-app viewer', () => {
  assert.match(chatSources, /className="chat-image-viewer"/);
  assert.match(chatArea, /setOpenedImageUrl/);
  assert.match(chatArea, /<ImageViewer/);
  assert.match(chatAreaCss, /\.chat-image-viewer\s*\{/);
});

test('round video messages stop when playback reaches the end', () => {
  const playerStart = mediaPlayers.indexOf('function VideoMessagePlayer');
  const playerEnd = mediaPlayers.indexOf('export {', playerStart);
  const player = mediaPlayers.slice(playerStart, playerEnd === -1 ? undefined : playerEnd);
  assert.doesNotMatch(player, /\sloop(?:\s|=)/);
  assert.match(player, /setProgress\(100\)/);
  assert.match(player, /setHasEnded\(true\)/);
});
