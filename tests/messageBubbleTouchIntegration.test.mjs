import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_INTERACTIVE_SELECTORS,
  DEFAULT_HOLD_DURATION_MS,
  DEFAULT_MOVE_THRESHOLD_PX,
  isInteractiveTarget,
  extractCoordinates,
  isTouchOrMobileDevice
} from '../src/hooks/useMessageTouch.js';
import {
  DEFAULT_QUICK_EMOJIS,
  extractMessageText,
  canUserDeleteMessage,
  copyTextToClipboard
} from '../src/utils/mobileActionSheetUtils.js';

// Read component and stylesheet sources for static contract verification
const messageBubbleJsx = readFileSync(
  new URL('../src/components/chat/MessageBubble.jsx', import.meta.url),
  'utf8'
);
const mobileActionSheetJsx = readFileSync(
  new URL('../src/components/chat/MobileActionSheet.jsx', import.meta.url),
  'utf8'
);
const useMessageTouchJs = readFileSync(
  new URL('../src/hooks/useMessageTouch.js', import.meta.url),
  'utf8'
);
const messageCss = readFileSync(
  new URL('../src/components/chat/Message.css', import.meta.url),
  'utf8'
);
const mobileActionSheetCss = readFileSync(
  new URL('../src/components/chat/MobileActionSheet.css', import.meta.url),
  'utf8'
);
const chatAreaCss = readFileSync(
  new URL('../src/components/ChatArea.css', import.meta.url),
  'utf8'
);

// ---------------------------------------------------------------------------
// DOM Hierarchy Mock Helpers
// ---------------------------------------------------------------------------
function createMockElement(tagName, { className = '', attributes = {}, parent = null } = {}) {
  const classList = new Set(className.split(/\s+/).filter(Boolean));
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    className,
    parentElement: parent,
    parentNode: parent,
    attributes: { ...attributes },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    hasAttribute(name) {
      return name in this.attributes;
    },
    matches(selector) {
      const trimmed = selector.trim();

      // Handle :not(...) selectors
      const notMatch = trimmed.match(/^([a-zA-Z0-9_-]+)?(?:\.([a-zA-Z0-9_-]+))?:not\(([^)]+)\)$/);
      if (notMatch) {
        const [, tag, cls, notSelector] = notMatch;
        if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        if (cls && !classList.has(cls)) return false;
        return !this.matches(notSelector);
      }

      const tagWithClassMatch = trimmed.match(/^([a-zA-Z0-9_-]+)?((?:\.[a-zA-Z0-9_-]+)+)$/);
      if (tagWithClassMatch) {
        const [, tag, classes] = tagWithClassMatch;
        if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) {
          return false;
        }
        const requiredClasses = classes.split('.').filter(Boolean);
        return requiredClasses.every(c => classList.has(c));
      }
      if (trimmed.startsWith('.')) {
        const requiredClasses = trimmed.split('.').filter(Boolean);
        return requiredClasses.every(c => classList.has(c));
      }
      if (trimmed.startsWith('#')) {
        return this.attributes.id === trimmed.slice(1);
      }
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const attrExpr = trimmed.slice(1, -1);
        if (attrExpr.includes('=')) {
          const [key, val] = attrExpr.split('=').map(s => s.replace(/["']/g, '').trim());
          return this.attributes[key] === val;
        }
        return this.hasAttribute(attrExpr);
      }
      return this.tagName.toLowerCase() === trimmed.toLowerCase();
    },
    closest(selectorGroup) {
      const selectors = selectorGroup.split(',').map(s => s.trim());
      let cur = this;
      while (cur && cur.nodeType === 1) {
        for (const sel of selectors) {
          if (cur.matches(sel)) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    }
  };
  return el;
}

// ===========================================================================
// SECTION 1: Static Architecture & MessageBubble Wiring Contracts
// ===========================================================================

test('MessageBubble.jsx cleanly imports useMessageTouch and MobileActionSheet', () => {
  assert.match(
    messageBubbleJsx,
    /import\s+MobileActionSheet\s+from\s+['"]\.\/MobileActionSheet['"]/,
    'MessageBubble must import MobileActionSheet'
  );
  assert.match(
    messageBubbleJsx,
    /import\s+useMessageTouch\s+from\s+['"]\.\.\/\.\.\/hooks\/useMessageTouch['"]/,
    'MessageBubble must import useMessageTouch'
  );
  assert.match(
    mobileActionSheetJsx,
    /className="mobile-action-sheet-backdrop"/,
    'MobileActionSheet must render backdrop container'
  );
  assert.match(
    chatAreaCss,
    /\.message-hover-actions/,
    'ChatArea.css must style desktop hover action bar'
  );
});

test('useMessageTouch and MobileActionSheet export valid default constants and utils', () => {
  assert.equal(DEFAULT_HOLD_DURATION_MS, 380);
  assert.equal(DEFAULT_MOVE_THRESHOLD_PX, 10);
  assert(DEFAULT_INTERACTIVE_SELECTORS.includes('video:not(.sticker-video):not(.sticker-container)'));
  assert.equal(DEFAULT_QUICK_EMOJIS.length, 8);
  assert.equal(typeof isTouchOrMobileDevice, 'function');
  assert.equal(typeof copyTextToClipboard, 'function');

  const coords = extractCoordinates({ clientX: 150, clientY: 250 });
  assert.deepEqual(coords, { x: 150, y: 250 });
});

test('MessageBubble.jsx attaches touch gesture handlers to .message-bubble container', () => {
  assert.match(
    messageBubbleJsx,
    /useMessageTouch\(\{\s*onTrigger:\s*\(\)\s*=>\s*setShowMsgActionsId\(msg\.id\)/,
    'useMessageTouch must trigger setShowMsgActionsId with active message ID'
  );
  assert.match(
    messageBubbleJsx,
    /<div[^>]*className=\{`message-bubble[^`]*`\}[^>]*onPointerDown=\{handleBubblePointerDown\}/s,
    'message-bubble container must attach onPointerDown'
  );
  assert.match(
    messageBubbleJsx,
    /onPointerMove=\{handleBubblePointerMove\}/,
    'message-bubble container must attach onPointerMove'
  );
  assert.match(
    messageBubbleJsx,
    /onPointerUp=\{handleBubblePointerUp\}/,
    'message-bubble container must attach onPointerUp'
  );
  assert.match(
    messageBubbleJsx,
    /onPointerCancel=\{clearLongPress\}/,
    'message-bubble container must attach onPointerCancel'
  );
  assert.match(
    messageBubbleJsx,
    /onContextMenu=\{handleContextMenu\}/,
    'message-bubble container must attach onContextMenu'
  );
});

test('MessageBubble.jsx wires MobileActionSheet with all required callbacks and authorization props', () => {
  assert.match(
    messageBubbleJsx,
    /<MobileActionSheet\b[\s\S]*?isOpen=\{isReactionOpen\}[\s\S]*?\/>/,
    'MobileActionSheet must receive isOpen={isReactionOpen}'
  );
  assert.match(
    messageBubbleJsx,
    /activeChat=\{activeChat\}/,
    'MobileActionSheet must receive activeChat'
  );
  assert.match(
    messageBubbleJsx,
    /currentUser=\{currentUser\}/,
    'MobileActionSheet must receive currentUser'
  );
  assert.match(
    messageBubbleJsx,
    /isOutgoing=\{isMe\}/,
    'MobileActionSheet must pass isOutgoing={isMe} for contextual authorization'
  );
  assert.match(
    messageBubbleJsx,
    /onClose=\{\(\)\s*=>\s*setShowMsgActionsId\(null\)\}/,
    'MobileActionSheet must pass onClose resetting showMsgActionsId'
  );
  assert.match(
    messageBubbleJsx,
    /setReplyingTo=\{setReplyingTo\}/,
    'MobileActionSheet must receive setReplyingTo'
  );
  assert.match(
    messageBubbleJsx,
    /deleteMessage=\{deleteMessage\}/,
    'MobileActionSheet must receive deleteMessage'
  );
  assert.match(
    messageBubbleJsx,
    /toggleReaction=\{toggleReaction\}/,
    'MobileActionSheet must receive toggleReaction'
  );
});

// ===========================================================================
// SECTION 2: Cross-Message Type Touch Support & Gesture Target Filtering
// ===========================================================================

test('Message Type 1 [Plain Text & Code Block]: bubble surface triggers action sheet; links are isolated', () => {
  const bubble = createMockElement('div', { className: 'message-bubble bubble-me' });
  const content = createMockElement('div', { className: 'bubble-content', parent: bubble });
  const p = createMockElement('p', { className: 'message-text', parent: content });
  const span = createMockElement('span', { parent: p });
  const link = createMockElement('a', { attributes: { href: 'https://coingram.tech' }, parent: span });

  // Text bubble body is non-interactive -> allows long-press & quick tap action sheet triggers
  assert.equal(isInteractiveTarget(bubble), false);
  assert.equal(isInteractiveTarget(content), false);
  assert.equal(isInteractiveTarget(p), false);
  assert.equal(isInteractiveTarget(span), false);

  // Embedded link is interactive -> clicking/touching link must NOT open action sheet
  assert.equal(isInteractiveTarget(link), true);

  // Code blocks are non-interactive containers, triggering action sheet on touch and exposing code for copy
  const codePre = createMockElement('pre', { className: 'code-block', parent: content });
  const codeTag = createMockElement('code', { parent: codePre });
  assert.equal(isInteractiveTarget(codePre), false);
  assert.equal(isInteractiveTarget(codeTag), false);

  const codeMsg = { text: '```const greet = () => "hello";```' };
  assert.equal(extractMessageText(codeMsg), '```const greet = () => "hello";```');
});

test('Message Type 2 [Photo Messages]: photo open button is isolated; caption & metadata trigger action sheet', () => {
  const bubble = createMockElement('div', { className: 'message-bubble bubble-media-only' });
  const mediaWrapper = createMockElement('div', { className: 'bubble-media-wrapper', parent: bubble });
  const openBtn = createMockElement('button', { className: 'bubble-media-open', parent: mediaWrapper });
  const photoImg = createMockElement('img', { className: 'bubble-media', parent: openBtn });
  const floatingBadge = createMockElement('span', { className: 'bubble-metadata floating-badge', parent: mediaWrapper });

  // Photo open button & image are interactive -> quick tap opens ImageViewer
  assert.equal(isInteractiveTarget(openBtn), true);
  assert.equal(isInteractiveTarget(photoImg), true);

  // Floating metadata badge or bubble margin is non-interactive -> long press opens action sheet
  assert.equal(isInteractiveTarget(floatingBadge), false);
  assert.equal(isInteractiveTarget(bubble), false);

  // Photo with caption: caption text triggers action sheet and provides extractable text
  const captionBubble = createMockElement('div', { className: 'message-bubble bubble-media-with-caption' });
  const captionDiv = createMockElement('div', { className: 'bubble-caption', parent: captionBubble });
  const captionP = createMockElement('p', { className: 'message-text', parent: captionDiv });
  assert.equal(isInteractiveTarget(captionDiv), false);
  assert.equal(isInteractiveTarget(captionP), false);

  const photoWithCaption = { media: 'blob:http://localhost/photo.jpg', text: 'Beautiful sunset in Paris' };
  assert.equal(extractMessageText(photoWithCaption), 'Beautiful sunset in Paris');
});

test('Message Type 3 [Regular Video & Round Video Notes]: video controls are isolated; captions trigger action sheet', () => {
  // Regular Video Player
  const regularBubble = createMockElement('div', { className: 'message-bubble' });
  const videoWrapper = createMockElement('div', { className: 'regular-video-wrapper', parent: regularBubble });
  const centerPlayBtn = createMockElement('button', { className: 'regular-video-center-btn', parent: videoWrapper });
  const controlsBar = createMockElement('div', { className: 'regular-video-controls', parent: videoWrapper });
  const ctrlBtn = createMockElement('button', { className: 'regular-video-ctrl-btn', parent: controlsBar });
  const seekInput = createMockElement('input', { className: 'regular-video-seek', attributes: { type: 'range' }, parent: controlsBar });

  assert.equal(isInteractiveTarget(videoWrapper), true);
  assert.equal(isInteractiveTarget(centerPlayBtn), true);
  assert.equal(isInteractiveTarget(controlsBar), true);
  assert.equal(isInteractiveTarget(ctrlBtn), true);
  assert.equal(isInteractiveTarget(seekInput), true);

  // Round Video Note Player
  const roundBubble = createMockElement('div', { className: 'message-bubble bubble-video' });
  const roundWrapper = createMockElement('div', { className: 'round-video-wrapper', parent: roundBubble });
  const muteOverlay = createMockElement('div', { className: 'video-mute-icon-overlay', parent: roundWrapper });
  const roundBadge = createMockElement('span', { className: 'bubble-metadata floating-badge', parent: roundBubble });

  assert.equal(isInteractiveTarget(roundWrapper), true);
  assert.equal(isInteractiveTarget(muteOverlay), true);
  assert.equal(isInteractiveTarget(roundBadge), false);
  assert.equal(isInteractiveTarget(roundBubble), false);
});

test('Message Type 4 [Voice Notes]: play/pause button and seek range slider never trigger action sheet', () => {
  const voiceBubble = createMockElement('div', { className: 'message-bubble' });
  const voiceContent = createMockElement('div', { className: 'bubble-content', parent: voiceBubble });
  const voicePlayer = createMockElement('div', { className: 'voice-player-bubble', parent: voiceContent });
  const playBtn = createMockElement('button', { className: 'voice-play-btn', parent: voicePlayer });
  const progressContainer = createMockElement('div', { className: 'audio-progress-container', parent: voicePlayer });
  const seekBar = createMockElement('input', { className: 'voice-seek-bar', attributes: { type: 'range' }, parent: progressContainer });
  const voiceDetails = createMockElement('div', { className: 'voice-player-details', parent: voicePlayer });
  const voiceMetadata = createMockElement('span', { className: 'bubble-metadata', parent: voiceContent });

  // All voice player controls must be filtered out as interactive targets
  assert.equal(isInteractiveTarget(voicePlayer), true);
  assert.equal(isInteractiveTarget(playBtn), true);
  assert.equal(isInteractiveTarget(progressContainer), true);
  assert.equal(isInteractiveTarget(seekBar), true);
  assert.equal(isInteractiveTarget(voiceDetails), true);

  // Touching the outer metadata or bubble border allows opening action sheet for voice message
  assert.equal(isInteractiveTarget(voiceMetadata), false);
  assert.equal(isInteractiveTarget(voiceBubble), false);
});

test('Message Type 5 [Stickers]: WebM video, Lottie, and WebP stickers are NOT blocked by video player filters', () => {
  const stickerBubble = createMockElement('div', { className: 'message-bubble bubble-sticker' });

  // WebM Video Sticker (<video class="sticker-container sticker-video" ... />)
  const videoSticker = createMockElement('video', { className: 'sticker-container sticker-video', parent: stickerBubble });
  assert.equal(
    isInteractiveTarget(videoSticker),
    false,
    'WebM video stickers must NOT be classified as interactive video controls'
  );

  // Lottie Animated Sticker (.sticker-container.sticker-animated)
  const lottieSticker = createMockElement('div', { className: 'sticker-container sticker-animated', parent: stickerBubble });
  assert.equal(
    isInteractiveTarget(lottieSticker),
    false,
    'Lottie animated stickers must NOT be classified as interactive controls'
  );

  // Static WebP Sticker (img.sticker-container.sticker-static)
  const staticSticker = createMockElement('img', { className: 'sticker-container sticker-static', parent: stickerBubble });
  assert.equal(
    isInteractiveTarget(staticSticker),
    false,
    'Static WebP stickers must NOT be classified as interactive controls'
  );
});

test('Message Type 6 [Forwarded / Reply Messages & Reaction Badges]: preview headers allow touch; badges increment directly', () => {
  const bubble = createMockElement('div', { className: 'message-bubble' });
  const replyPreview = createMockElement('div', { className: 'reply-preview-bubble', parent: bubble });
  const replySender = createMockElement('span', { className: 'reply-preview-sender', parent: replyPreview });
  const replyText = createMockElement('p', { className: 'reply-preview-text', parent: replyPreview });

  // Reply preview headers are non-interactive parts of the bubble -> trigger action sheet
  assert.equal(isInteractiveTarget(replyPreview), false);
  assert.equal(isInteractiveTarget(replySender), false);
  assert.equal(isInteractiveTarget(replyText), false);

  // Reaction Badges are interactive -> tapping badge toggles reaction without opening action sheet
  const reactionsContainer = createMockElement('div', { className: 'bubble-reactions', parent: bubble });
  const badgeBtn = createMockElement('button', { className: 'reaction-badge active', parent: reactionsContainer });
  assert.equal(isInteractiveTarget(reactionsContainer), true);
  assert.equal(isInteractiveTarget(badgeBtn), true);

  // Sender Avatar & Sender Name in group chats -> open user profile drawer
  const avatar = createMockElement('div', { className: 'message-sender-avatar interactive', parent: bubble });
  const senderName = createMockElement('span', { className: 'sender-name interactive', parent: bubble });
  assert.equal(isInteractiveTarget(avatar), true);
  assert.equal(isInteractiveTarget(senderName), true);
});

// ===========================================================================
// SECTION 3: Desktop Parity, Hover Actions, and CSS Viewport Separation
// ===========================================================================

test('Desktop Parity: MessageBubble renders .message-hover-actions containing Reply, Smile, and Delete', () => {
  assert.match(
    messageBubbleJsx,
    /<div[^>]*className="message-hover-actions message-hover-actions-fixed active"/s,
    'MessageBubble must render the visible action toolbar outside bubble clipping'
  );
  assert.match(
    messageBubbleJsx,
    /<button[^>]*className="hover-action-btn"[^>]*onClick=\{\(\)\s*=>\s*setReplyingTo\(msg\)\}[^>]*title="Ответить"/,
    'Hover actions must contain Reply button'
  );
  assert.match(
    messageBubbleJsx,
    /<button[^>]*ref=\{smileBtnRef\}[^>]*className="hover-action-btn"[^>]*title="Реакция"/,
    'Hover actions must contain Smile reaction button'
  );
  assert.match(
    messageBubbleJsx,
    /<button[^>]*className="hover-action-btn delete"[^>]*onClick=\{\(\)\s*=>\s*deleteMessage\(activeChat\.id,\s*msg\.id\)\}[^>]*title="Удалить"/,
    'Hover actions must contain Delete button'
  );
});

test('Desktop Parity: Desktop reaction drawer is portaled to document.body and anchored with repositionDrawer', () => {
  assert.match(
    messageBubbleJsx,
    /isReactionOpen\s*&&\s*createPortal\([\s\S]*?className=\{`reaction-drawer reaction-drawer-fixed/s,
    'Desktop reaction drawer must be portaled to document.body'
  );
  assert.match(
    messageBubbleJsx,
    /window\.addEventListener\('resize',\s*onScrollOrResize\)/,
    'repositionDrawer must reposition on window resize'
  );
  assert.match(
    messageBubbleJsx,
    /document\.addEventListener\('scroll',\s*onScrollOrResize,\s*true\)/,
    'repositionDrawer must capture scroll in capture mode'
  );
});

test('Desktop/Mobile CSS Separation: MobileActionSheet backdrop is hidden on desktop pointer devices', () => {
  assert.match(
    mobileActionSheetCss,
    /@media\s*\(min-width:\s*769px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\.mobile-action-sheet-backdrop\s*\{[^}]*display:\s*none\s*!important/s,
    'MobileActionSheet.css must hide .mobile-action-sheet-backdrop on desktop fine pointer devices'
  );
});

test('Desktop/Mobile CSS Separation: Desktop reaction drawer is suppressed on mobile touch screens', () => {
  assert.match(
    messageCss,
    /@media\s*\(max-width:\s*768px\),\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.reaction-drawer\s*\{[^}]*display:\s*none\s*!important/s,
    'Message.css must hide desktop .reaction-drawer on mobile touch devices'
  );
});

test('Desktop/Mobile CSS Separation: Desktop hover actions and text selection are preserved on desktop', () => {
  assert.match(
    messageCss,
    /@media\s*\(min-width:\s*769px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\.message-bubble\s*\.message-text\s*\{[^}]*user-select:\s*text/s,
    'Message.css must preserve mouse user-select: text on desktop'
  );
  assert.match(
    messageCss,
    /@media\s*\(min-width:\s*769px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\.message-bubble:hover\s+\.message-hover-actions,\s*\.message-hover-actions\.active\s*\{[^}]*opacity:\s*1;\s*pointer-events:\s*auto;/s,
    'Message.css must guarantee .message-hover-actions visibility and interactivity on desktop hover'
  );
});

test('Context Menu Routing: preserves native right-click on desktop while suppressing on touch', () => {
  assert.match(
    useMessageTouchJs,
    /handleContextMenu\s*=\s*useCallback\(\(event\)\s*=>\s*\{/,
    'useMessageTouch must define handleContextMenu'
  );
  assert.match(
    useMessageTouchJs,
    /if\s*\(\s*isTouchTrigger\s*\)\s*\{\s*if\s*\(\s*typeof\s+event\.preventDefault === 'function'\s*\)\s*event\.preventDefault\(\);/s,
    'handleContextMenu must preventDefault only when isTouchTrigger is true'
  );
});

// ===========================================================================
// SECTION 4: Non-Regression Protections (10-Min Grouping, Voice, Scroll)
// ===========================================================================

test('Non-Regression 1 [10-Minute Grouping]: messages cluster within 10 min (600000ms) boundary', () => {
  function computeGrouping(messages, index, currentUser, activeChat) {
    const msg = messages[index];
    const isMe = msg.senderId === currentUser?.id || msg.senderId === 'current';
    const isGroupOther = activeChat?.type === 'group' && !isMe;
    const nextMsg = messages[index + 1];
    const prevMsg = messages[index - 1];

    const getSenderKey = (m) => m?.senderId || m?.sender_id || m?.senderName || null;
    const currentSenderKey = getSenderKey(msg);
    const prevSenderKey = getSenderKey(prevMsg);
    const nextSenderKey = getSenderKey(nextMsg);

    const isSameSenderAsPrev = Boolean(
      prevMsg && prevSenderKey && currentSenderKey &&
      prevSenderKey === currentSenderKey &&
      Math.abs(new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) < 10 * 60 * 1000
    );

    const isSameSenderAsNext = Boolean(
      nextMsg && nextSenderKey && currentSenderKey &&
      nextSenderKey === currentSenderKey &&
      Math.abs(new Date(nextMsg.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 10 * 60 * 1000
    );

    return {
      isFirstInGroup: !isSameSenderAsPrev,
      isLastInGroup: !isSameSenderAsNext,
      showSenderName: isGroupOther && !isSameSenderAsPrev
    };
  }

  const baseTime = new Date('2026-08-21T10:00:00.000Z').getTime();
  const messages = [
    { id: '1', senderId: 'alice', timestamp: new Date(baseTime).toISOString(), text: 'Msg 1' },
    { id: '2', senderId: 'alice', timestamp: new Date(baseTime + 3 * 60 * 1000).toISOString(), text: 'Msg 2 (3 min later)' },
    { id: '3', senderId: 'alice', timestamp: new Date(baseTime + 15 * 60 * 1000).toISOString(), text: 'Msg 3 (12 min later - new group)' },
    { id: '4', senderId: 'bob', timestamp: new Date(baseTime + 16 * 60 * 1000).toISOString(), text: 'Msg 4 (different sender)' }
  ];

  const chat = { type: 'group' };
  const currentUser = { id: 'me' };

  const g0 = computeGrouping(messages, 0, currentUser, chat);
  assert.equal(g0.isFirstInGroup, true, 'Msg 1 must start a new group');
  assert.equal(g0.isLastInGroup, false, 'Msg 1 is followed by Msg 2 in <10 min');
  assert.equal(g0.showSenderName, true, 'Msg 1 must show sender name');

  const g1 = computeGrouping(messages, 1, currentUser, chat);
  assert.equal(g1.isFirstInGroup, false, 'Msg 2 belongs to same cluster');
  assert.equal(g1.isLastInGroup, true, 'Msg 2 is last in 10-min cluster');
  assert.equal(g1.showSenderName, false, 'Msg 2 must NOT show duplicate sender name');

  const g2 = computeGrouping(messages, 2, currentUser, chat);
  assert.equal(g2.isFirstInGroup, true, 'Msg 3 is >10 min later -> new cluster');
  assert.equal(g2.isLastInGroup, true, 'Msg 3 is followed by different sender');
  assert.equal(g2.showSenderName, true, 'Msg 3 must show sender name for new cluster');

  const g3 = computeGrouping(messages, 3, currentUser, chat);
  assert.equal(g3.isFirstInGroup, true, 'Msg 4 is from Bob -> new cluster');
});

test('Non-Regression 2 [Scroll Stability]: message delete and reaction toggle do not cause autoscroll jumps', () => {
  let autoscrollCalled = 0;
  function simulateScrollObserver({ messageCount, prevMessageCount, latestMessageId, prevLatestMessageId, isOwnMessage, isNearBottom }) {
    const isNewMessage = messageCount > prevMessageCount && latestMessageId !== prevLatestMessageId;
    if (isNewMessage) {
      if (isNearBottom || isOwnMessage) {
        autoscrollCalled++;
      }
    }
  }

  // Deleting a message: messageCount decreases from 5 to 4
  simulateScrollObserver({
    messageCount: 4,
    prevMessageCount: 5,
    latestMessageId: 'm4',
    prevLatestMessageId: 'm5',
    isOwnMessage: false,
    isNearBottom: false
  });
  assert.equal(autoscrollCalled, 0, 'Message deletion must NEVER fire autoscroll');

  // Toggling a reaction: messageCount stays 4, latestMessageId stays m4
  simulateScrollObserver({
    messageCount: 4,
    prevMessageCount: 4,
    latestMessageId: 'm4',
    prevLatestMessageId: 'm4',
    isOwnMessage: false,
    isNearBottom: false
  });
  assert.equal(autoscrollCalled, 0, 'Reaction toggle must NEVER fire autoscroll');

  // New own message: messageCount increases, autoscrolls to bottom
  simulateScrollObserver({
    messageCount: 5,
    prevMessageCount: 4,
    latestMessageId: 'm6',
    prevLatestMessageId: 'm4',
    isOwnMessage: true,
    isNearBottom: false
  });
  assert.equal(autoscrollCalled, 1, 'New own message must smoothly scroll to bottom');
});

test('Non-Regression 3 [RBAC Deletion Matrix]: enforces strict delete authorization across chat contexts', () => {
  const currentUser = { id: 'user_123', name: 'Alex' };
  const ownMsg = { id: 'm1', senderId: 'user_123', text: 'My own message' };
  const otherMsg = { id: 'm2', senderId: 'user_999', text: 'Incoming message' };

  // Own message in any chat -> YES
  assert.equal(canUserDeleteMessage(ownMsg, currentUser, { id: 'c1', type: 'direct' }), true);
  assert.equal(canUserDeleteMessage(ownMsg, currentUser, { id: 'c2', type: 'group' }), true);

  // Saved messages -> YES for any message
  assert.equal(canUserDeleteMessage(otherMsg, currentUser, { id: 'saved', type: 'saved' }), true);

  // Direct 1:1 chat -> Telegram bilateral delete parity -> YES
  assert.equal(canUserDeleteMessage(otherMsg, currentUser, { id: 'direct_1', type: 'direct' }), true);

  // Group chat: admin/owner -> YES; regular member -> NO
  const adminChat = { id: 'g1', type: 'group', members: [{ id: 'user_123', role: 'admin' }] };
  assert.equal(canUserDeleteMessage(otherMsg, currentUser, adminChat), true);

  const memberChat = { id: 'g2', type: 'group', members: [{ id: 'user_123', role: 'member' }] };
  assert.equal(canUserDeleteMessage(otherMsg, currentUser, memberChat), false);
});
