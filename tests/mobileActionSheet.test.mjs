import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_QUICK_EMOJIS,
  extractMessageText,
  copyTextToClipboard,
  canUserDeleteMessage
} from '../src/utils/mobileActionSheetUtils.js';
import { normalizeReaction } from '../src/utils/reactionUtils.ts';

const sheetCode = await readFile(
  new URL('../src/components/chat/MobileActionSheet.jsx', import.meta.url),
  'utf8'
);
const sheetCssCode = await readFile(
  new URL('../src/components/chat/MobileActionSheet.css', import.meta.url),
  'utf8'
);
const chatAreaCssCode = await readFile(
  new URL('../src/components/ChatArea.css', import.meta.url),
  'utf8'
);

// ---------------------------------------------------------------------------
// 1. Static Contract & CSS Ergonomics Verification
// ---------------------------------------------------------------------------

test('MobileActionSheet contains required actions, quick reaction bar, and DOM markers', () => {
  assert(Array.isArray(DEFAULT_QUICK_EMOJIS));
  assert.equal(DEFAULT_QUICK_EMOJIS.length, 8);
  assert.deepEqual(DEFAULT_QUICK_EMOJIS, ['❤️', '👍', '👎', '🔥', '😂', '👏', '🎉', '😢']);

  // Required actions and callbacks
  assert.match(sheetCode, /toggleReaction\(activeChat\.id,\s*msg\.id,\s*emo\)/);
  assert.match(sheetCode, /setReplyingTo\(msg\)/);
  assert.match(sheetCode, /copyTextToClipboard\(copyableText\)/);
  assert.match(sheetCode, /deleteMessage\(activeChat\.id,\s*msg\.id\)/);
  assert.match(sheetCode, /createPortal/);

  // Dual-mode props
  assert.match(sheetCode, /onReactionSelect/);
  assert.match(sheetCode, /onReply/);
  assert.match(sheetCode, /onCopy/);
  assert.match(sheetCode, /onDelete/);
  assert.match(sheetCode, /canDelete/);
  assert.match(sheetCode, /isOutgoing/);

  // Haptic feedbacks
  assert.match(sheetCode, /triggerHaptic\(12\)/);
  assert.match(sheetCode, /triggerHaptic\(10\)/);
  assert.match(sheetCode, /triggerHaptic\(15\)/);

  // Accessibility and Dismissal
  assert.match(sheetCode, /e\.key === 'Escape'/);
  assert.match(sheetCode, /className="mobile-action-sheet-backdrop"/);
  assert.match(sheetCode, /if \(event\.target === event\.currentTarget && backdropPointerDownRef\.current\)/);
  assert.match(sheetCode, /e\.stopPropagation\(\)/);
  assert.match(sheetCode, /data-test="mobile-action-sheet-backdrop"/);
  assert.match(sheetCode, /data-test="mobile-action-sheet"/);
  assert.match(sheetCode, /data-test="mobile-action-reply"/);
  assert.match(sheetCode, /data-test="mobile-action-copy"/);
  assert.match(sheetCode, /data-test="mobile-action-delete"/);
});

test('MobileActionSheet.css enforces strict touch targets (>=44px), flat backdrop, and safe-area insets', () => {
  // Backdrop
  assert.match(sheetCssCode, /\.mobile-action-sheet-backdrop\s*\{/);
  assert.match(sheetCssCode, /position:\s*fixed/);
  assert.match(sheetCssCode, /inset:\s*0/);
  assert.doesNotMatch(sheetCssCode, /backdrop-filter:/);
  assert.match(sheetCssCode, /env\(safe-area-inset-bottom/);

  // Card container
  assert.match(sheetCssCode, /\.mobile-action-sheet\s*\{/);
  assert.match(sheetCssCode, /border-radius:\s*12px 12px 0 0/);
  assert.match(sheetCssCode, /max-width:\s*440px/);

  // Reaction carousel & pills (>=44px)
  assert.match(sheetCssCode, /\.mobile-sheet-reactions\s*\{/);
  assert.match(sheetCssCode, /overflow-x:\s*auto/);
  assert.match(sheetCssCode, /scrollbar-width:\s*none/);
  assert.match(sheetCssCode, /\.mobile-sheet-reaction-pill\s*\{/);
  assert.match(sheetCssCode, /height:\s*44px/);
  assert.match(sheetCssCode, /width:\s*44px/);

  // Action buttons (>=44px, min-height: 48px)
  assert.match(sheetCssCode, /\.mobile-sheet-item\s*\{/);
  assert.match(sheetCssCode, /min-height:\s*48px/);
  assert.match(sheetCssCode, /touch-action:\s*manipulation/);
  assert.match(sheetCssCode, /-webkit-tap-highlight-color:\s*transparent/);

  // Animations & media queries
  assert.match(sheetCssCode, /@keyframes mobileBackdropFadeIn/);
  assert.match(sheetCssCode, /@keyframes mobileSheetSlideUp/);
  assert.match(sheetCssCode, /@media \(prefers-reduced-motion: reduce\)/);
});

test('ChatArea prevents touch callouts and the sheet owns its 44px touch targets', () => {
  assert.match(chatAreaCssCode, /-webkit-touch-callout:\s*none/);
  assert.match(sheetCssCode, /min-height:\s*48px/);
  assert.match(sheetCssCode, /height:\s*44px/);
  assert.match(sheetCssCode, /\.mobile-action-sheet-backdrop/);
  assert.match(sheetCssCode, /\.mobile-action-sheet/);
});

// ---------------------------------------------------------------------------
// 2. Pure Helper & Permission Matrix Verification
// ---------------------------------------------------------------------------

test('extractMessageText correctly parses human text and filters placeholders, voice, video, stickers', () => {
  // Plain text
  assert.equal(extractMessageText({ text: 'Привет! Как дела?' }), 'Привет! Как дела?');
  assert.equal(extractMessageText({ text: '  Многострочный\nтекст  ' }), 'Многострочный\nтекст');

  // Photo & video with user captions
  assert.equal(extractMessageText({ text: 'Закат в горах', media: 'https://cdn.example.com/photo.jpg' }), 'Закат в горах');
  assert.equal(extractMessageText({ caption: 'Красивое видео', media: 'https://cdn.example.com/video.mp4' }), 'Красивое видео');

  // Media system placeholders without custom text -> should return empty string
  assert.equal(extractMessageText({ text: '🖼️ [Изображение]' }), '');
  assert.equal(extractMessageText({ text: '[Изображение]' }), '');
  assert.equal(extractMessageText({ text: 'Изображение' }), '');
  assert.equal(extractMessageText({ text: '🎬 [Видео]' }), '');
  assert.equal(extractMessageText({ text: '[Видео]' }), '');
  assert.equal(extractMessageText({ text: 'Видео' }), '');

  // Voice notes, round video notes, stickers -> should return empty string
  assert.equal(extractMessageText({ text: '🎤 Голосовое сообщение (0:15)' }), '');
  assert.equal(extractMessageText({ text: 'Голосовое сообщение' }), '');
  assert.equal(extractMessageText({ text: '🎬 Видеосообщение (0:30)' }), '');
  assert.equal(extractMessageText({ text: 'Видеосообщение' }), '');
  assert.equal(extractMessageText({ text: 'sticker:tgs:coingram_pack_123' }), '');

  // Edge cases: null, empty string, non-object
  assert.equal(extractMessageText(null), '');
  assert.equal(extractMessageText(undefined), '');
  assert.equal(extractMessageText({}), '');
  assert.equal(extractMessageText({ text: '   ' }), '');
  assert.equal(extractMessageText('not a message object'), '');
});

test('canUserDeleteMessage accurately evaluates permissions matrix', () => {
  const currentUser = { id: 'user_123', name: 'Alice' };

  // 1. Explicit canDelete prop overrides everything
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'group_1' }, false), false);
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'group_1' }, true), true);

  // 2. Explicit isOutgoing prop
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'group_1' }, undefined, true), true);
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'group_1' }, undefined, false), false);

  // 3. Own messages (senderId === currentUser.id or 'current' or isOutgoing: true)
  assert.equal(canUserDeleteMessage({ senderId: 'user_123' }, currentUser, { id: 'group_1' }), true);
  assert.equal(canUserDeleteMessage({ senderId: 'current' }, currentUser, { id: 'group_1' }), true);
  assert.equal(canUserDeleteMessage({ sender_id: 'user_123' }, currentUser, { id: 'group_1' }), true);
  assert.equal(canUserDeleteMessage({ isOutgoing: true }, currentUser, { id: 'group_1' }), true);
  assert.equal(canUserDeleteMessage({ isMe: true }, currentUser, { id: 'group_1' }), true);

  // 4. Saved Messages chat (user has full ownership)
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'saved' }), true);
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'chat_9', isSaved: true }), true);
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'chat_9', type: 'saved' }), true);

  // 5. Group Admin / Owner privileges
  const adminChat = {
    id: 'group_admin_chat',
    members: [{ id: 'user_123', role: 'admin' }, { id: 'user_456', role: 'member' }]
  };
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, adminChat), true);

  const ownerChat = {
    id: 'group_owner_chat',
    creatorId: 'user_123',
    members: [{ id: 'user_123', role: 'member' }]
  };
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, ownerChat), true);

  // 6. Direct 1:1 chat parity
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, { id: 'dm_1', type: 'direct' }), true);

  // 7. Incoming message in group where user is regular member -> Delete not permitted
  const regularGroupChat = {
    id: 'group_regular',
    type: 'group',
    creatorId: 'user_999',
    members: [{ id: 'user_123', role: 'member' }, { id: 'user_456', role: 'member' }]
  };
  assert.equal(canUserDeleteMessage({ senderId: 'user_456' }, currentUser, regularGroupChat), false);

  // Defensive: null message
  assert.equal(canUserDeleteMessage(null, currentUser, regularGroupChat), false);
});

test('copyTextToClipboard executes tier 1 navigator.clipboard or tier 2 execCommand fallback', async () => {
  const origDocument = globalThis.document;

  try {
    // 1. Tier 1: Modern async clipboard
    let clipboardWrittenText = null;
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          clipboardWrittenText = text;
        }
      },
      configurable: true
    });
    const res1 = await copyTextToClipboard('Hello Clipboard');
    assert.equal(res1, true);
    assert.equal(clipboardWrittenText, 'Hello Clipboard');

    // 2. Tier 2: execCommand fallback when navigator.clipboard throws
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('NotAllowedError');
        }
      },
      configurable: true
    });

    let execCommandAction = null;
    let appendedChild = null;
    let removedChild = null;

    globalThis.document = {
      body: {
        appendChild: (child) => {
          appendedChild = child;
        },
        removeChild: (child) => {
          removedChild = child;
        }
      },
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        value: '',
        style: {},
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {}
      }),
      execCommand: (command) => {
        execCommandAction = command;
        return true;
      }
    };

    const res2 = await copyTextToClipboard('Fallback Text');
    assert.equal(res2, true);
    assert.equal(execCommandAction, 'copy');
    assert.notEqual(appendedChild, null);
    assert.equal(appendedChild.value, 'Fallback Text');
    assert.equal(removedChild, appendedChild);

    // 3. Empty text -> returns false immediately
    assert.equal(await copyTextToClipboard(''), false);
    assert.equal(await copyTextToClipboard(null), false);
  } finally {
    globalThis.document = origDocument;
    delete globalThis.navigator.clipboard;
  }
});

// ---------------------------------------------------------------------------
// 3. Active Reaction Normalization & Highlighting Logic
// ---------------------------------------------------------------------------

test('Reaction matching correctly identifies active user reaction', () => {
  const currentUser = { id: 'user_99' };
  const targetMsg = {
    id: 'msg_1',
    reactions: [
      { emoji: '🔥', users: ['user_99'] },
      { emoji: '❤️', users: ['other_1', 'other_2'] },
      { emoji: '👍', userId: 'current' }
    ]
  };

  const isEmojiActive = (emo) => {
    return targetMsg.reactions?.some((r) => {
      const norm = normalizeReaction(r);
      return (
        r.emoji === emo &&
        (norm.users.includes('current') ||
          norm.users.includes('me') ||
          (currentUser && norm.users.includes(currentUser.id)))
      );
    });
  };

  assert.equal(isEmojiActive('🔥'), true);
  assert.equal(isEmojiActive('❤️'), false);
  assert.equal(isEmojiActive('👍'), true);
  assert.equal(isEmojiActive('🎉'), false);
});
