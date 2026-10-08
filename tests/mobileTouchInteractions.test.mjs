import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const mobileActionSheetCode = await readFile(
  new URL('../src/components/chat/MobileActionSheet.jsx', import.meta.url),
  'utf8'
);
const messageBubbleCode = await readFile(
  new URL('../src/components/chat/MessageBubble.jsx', import.meta.url),
  'utf8'
);
const chatAreaCssCode = await readFile(
  new URL('../src/components/ChatArea.css', import.meta.url),
  'utf8'
);
const sheetCssCode = await readFile(
  new URL('../src/components/chat/MobileActionSheet.css', import.meta.url),
  'utf8'
);
const chatAreaCode = await readFile(
  new URL('../src/components/ChatArea.jsx', import.meta.url),
  'utf8'
);

test('MobileActionSheet contains required actions: reactions, reply, copy, delete', () => {
  assert.match(mobileActionSheetCode, /toggleReaction\(activeChat\.id,\s*msg\.id,\s*emo\)/);
  assert.match(mobileActionSheetCode, /setReplyingTo\(msg\)/);
  assert.match(mobileActionSheetCode, /copyTextToClipboard\(copyableText\)/);
  assert.match(mobileActionSheetCode, /deleteMessage\(activeChat\.id,\s*msg\.id\)/);
  assert.match(mobileActionSheetCode, /createPortal/);
});

test('MobileActionSheet handles escape key and backdrop dismissals', () => {
  assert.match(mobileActionSheetCode, /e\.key === 'Escape'/);
  assert.match(mobileActionSheetCode, /className="mobile-action-sheet-backdrop"/);
  assert.match(mobileActionSheetCode, /if \(event\.target === event\.currentTarget && backdropPointerDownRef\.current\)/);
  assert.match(mobileActionSheetCode, /e\.stopPropagation\(\)/);
});

test('MessageBubble integrates MobileActionSheet with touch and tap handlers', () => {
  assert.match(messageBubbleCode, /import MobileActionSheet from '\.\/MobileActionSheet';/);
  assert.match(messageBubbleCode, /<MobileActionSheet/);
  assert.match(messageBubbleCode, /onPointerDown=\{handleBubblePointerDown\}/);
  assert.match(messageBubbleCode, /onPointerUp=\{handleBubblePointerUp\}/);
  assert.match(messageBubbleCode, /onContextMenu=\{handleContextMenu\}/);
});

test('MessageBubble ignores tap/long-press on interactive controls', () => {
  assert.match(messageBubbleCode, /isInteractiveTarget/);
  assert.match(messageBubbleCode, /voice-play-btn/);
  assert.match(messageBubbleCode, /audio-progress-container/);
  assert.match(messageBubbleCode, /failed-message-menu/);
  assert.match(messageBubbleCode, /reaction-badge/);
});

test('ChatArea includes mobile action sheet in click-outside dismiss logic', () => {
  assert.match(chatAreaCode, /!e\.target\.closest\('\.mobile-action-sheet'\)/);
  assert.match(chatAreaCode, /!e\.target\.closest\('\.mobile-action-sheet-backdrop'\)/);
  assert.match(chatAreaCode, /document\.addEventListener\('pointerdown', handleOutsideClick\)/);
});

test('ChatArea prevents touch callouts and the sheet owns its 44px touch targets', () => {
  assert.match(chatAreaCssCode, /-webkit-touch-callout:\s*none/);
  assert.match(sheetCssCode, /min-height:\s*48px/);
  assert.match(sheetCssCode, /height:\s*44px/);
  assert.match(sheetCssCode, /\.mobile-action-sheet-backdrop/);
  assert.match(sheetCssCode, /\.mobile-action-sheet/);
});
