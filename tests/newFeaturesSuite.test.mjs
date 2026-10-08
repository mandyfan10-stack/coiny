import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  showIncomingNotification
} from '../src/services/notificationService.js';
import useEdgeSwipeBack from '../src/hooks/useSwipeGesture.js';

const callOverlayCode = await readFile(
  new URL('../src/components/call/CallOverlay.jsx', import.meta.url),
  'utf8'
);
const messageBubbleCode = await readFile(
  new URL('../src/components/chat/MessageBubble.jsx', import.meta.url),
  'utf8'
);
const chatAreaCode = await readFile(
  new URL('../src/components/ChatArea.jsx', import.meta.url),
  'utf8'
);
const composerCode = await readFile(new URL('../src/components/chat/ChatComposer.jsx', import.meta.url), 'utf8');
const useMessageTouchCode = await readFile(
  new URL('../src/hooks/useMessageTouch.js', import.meta.url),
  'utf8'
);
const notificationsTabCode = await readFile(
  new URL('../src/components/settings/NotificationsTab.jsx', import.meta.url),
  'utf8'
);

test('CallOverlay renders Sparkles icon with intuitive noise suppression title and aria-label', () => {
  assert.match(callOverlayCode, /<Sparkles\s+size=\{20\}\s*\/>/);
  assert.match(callOverlayCode, /Шумоподавление:\s*Включено/);
  assert.match(callOverlayCode, /Шумоподавление:\s*Выключено/);
});

test('useMessageTouch hook provides swipe-to-reply gesture support', () => {
  assert.match(useMessageTouchCode, /onSwipeReply/);
  assert.match(useMessageTouchCode, /swipeOffset/);
  assert.match(useMessageTouchCode, /isSwiping/);
});

test('MessageBubble integrates swipeOffset transform and reply indicator', () => {
  assert.match(messageBubbleCode, /onSwipeReply/);
  assert.match(messageBubbleCode, /transform:\s*swipeOffset\s*\?\s*`translateX\(\$\{swipeOffset\}px\)`/);
  assert.match(messageBubbleCode, /message-swipe-reply-indicator/);
});

test('ChatArea preserves scroll positions per chat and handles unread divider', () => {
  assert.match(chatAreaCode, /chatScrollPositionsRef/);
  assert.match(chatAreaCode, /coingram_chat_scroll_/);
  assert.match(chatAreaCode, /getSavedChatScroll/);
  assert.match(chatAreaCode, /saveChatScroll/);
  assert.match(chatAreaCode, /saveCurrentScrollPosition/);
  assert.match(chatAreaCode, /unread-messages-divider/);
  assert.match(chatAreaCode, /Непрочитанные сообщения/);
  assert.match(chatAreaCode, /useEdgeSwipeBack/);
});

test('useSwipeGesture module exports useEdgeSwipeBack function', () => {
  assert.equal(typeof useEdgeSwipeBack, 'function');
});

test('notificationService safely handles non-browser / node environments without crashing', async () => {
  assert.equal(isNotificationSupported(), false);
  assert.equal(getNotificationPermission(), 'denied');
  const perm = await requestNotificationPermission();
  assert.equal(perm, 'denied');
  const notif = await showIncomingNotification({ title: 'Test', body: 'Body' });
  assert.equal(notif, null);
});

test('NotificationsTab requests notification permissions on toggle', () => {
  assert.match(notificationsTabCode, /requestNotificationPermission/);
  assert.match(notificationsTabCode, /Звуковые и push-уведомления/);
});

test('Video message metadata is placed at top right to prevent collision with bottom seek timeline', async () => {
  const chatAreaCss = await readFile(
    new URL('../src/components/ChatArea.css', import.meta.url),
    'utf8'
  );
  assert.match(messageBubbleCode, /video-floating-badge/);
  assert.match(chatAreaCss, /\.bubble-metadata\.floating-badge\.video-floating-badge\s*\{[^}]*top:\s*8px/);
});

test('useChatUiState implements window.handleAndroidBackButton for Android hardware back', async () => {
  const uiStateCode = await readFile(
    new URL('../src/context/chat/useChatUiState.js', import.meta.url),
    'utf8'
  );
  assert.match(uiStateCode, /handleAndroidBackButton/);
});

test('MainActivity.java delegates onBackPressed to window.handleAndroidBackButton', async () => {
  const mainActivityCode = await readFile(
    new URL('../android/app/src/main/java/com/coingram/chat/MainActivity.java', import.meta.url),
    'utf8'
  );
  assert.match(mainActivityCode, /onBackPressed/);
  assert.match(mainActivityCode, /handleAndroidBackButton/);
});

test('getReplyPreviewText formats media and text reply previews intuitively without emojis', async () => {
  const { getReplyPreviewText, getReplyType } = await import('../src/utils/mobileActionSheetUtils.js');
  assert.equal(getReplyPreviewText({ text: 'Привет, как дела?' }), 'Привет, как дела?');
  assert.equal(getReplyPreviewText({ media: 'https://example.com/photo.jpg' }), 'Фото');
  assert.equal(getReplyPreviewText({ media: 'https://example.com/video.mp4', mediaType: 'video' }), 'Видео');
  assert.equal(getReplyPreviewText({ media: 'https://example.com/round.webm', mediaType: 'video_note' }), 'Видеосообщение');
  assert.equal(getReplyPreviewText({ media: 'https://example.com/voice.ogg', mediaType: 'voice' }), 'Голосовое сообщение');
  assert.equal(getReplyPreviewText({ media: 'https://example.com/sticker.tgs', mediaType: 'sticker' }), 'Стикер');
  assert.equal(getReplyPreviewText({ text: 'Подпись к фото', media: 'https://example.com/photo.jpg' }), 'Подпись к фото');

  assert.deepEqual(getReplyType({ media: 'https://example.com/photo.jpg' }), { type: 'image', label: 'Фото' });
  assert.deepEqual(getReplyType({ media: 'https://example.com/voice.ogg', mediaType: 'voice' }), { type: 'voice', label: 'Голосовое сообщение' });
});

test('the live composer and MessageBubble use getReplyType and SVG icons for reply previews', () => {
  assert.match(chatAreaCode, /<ChatComposer/);
  assert.match(composerCode, /getReplyType\(replyingTo\)/);
  assert.match(messageBubbleCode, /getReplyType\(replyMsg\)/);
  assert.match(composerCode, /reply-media-svg/);
  assert.match(messageBubbleCode, /reply-media-svg/);
});

test('ChatArea.css guarantees media bubble overflow: visible and precise desktop hover hitbox', async () => {
  const chatAreaCss = await readFile(
    new URL('../src/components/ChatArea.css', import.meta.url),
    'utf8'
  );
  assert.match(chatAreaCss, /\.message-bubble\.bubble-media-only\s*\{[^}]*overflow:\s*visible/s);
  assert.match(chatAreaCss, /\.message-bubble\.bubble-media-with-caption\s*\{[^}]*overflow:\s*visible/s);
  assert.match(chatAreaCss, /\.message-bubble\.bubble-media-only\s+\.bubble-media-wrapper\s*\{[^}]*overflow:\s*hidden/s);
  assert.ok(!chatAreaCss.includes('.message-row:hover .message-hover-actions'), 'Must not use full-width row hover for message action triggers');
});

test('StoryViewer implements robust separate manual pause and hold-to-pause gestures', async () => {
  const storyViewerCode = await readFile(
    new URL('../src/components/StoryViewer.jsx', import.meta.url),
    'utf8'
  );
  assert.match(storyViewerCode, /isManualPaused/);
  assert.match(storyViewerCode, /isHolding/);
  assert.match(storyViewerCode, /startTimeRef\.current\s*=\s*null;/);
  assert.match(storyViewerCode, /e\.code\s*===\s*'Space'/);
  assert.match(storyViewerCode, /handlePointerDown/);
  assert.match(storyViewerCode, /handlePointerUp/);
});

test('Telegram Stories: Story Studio camera/editor and StoryViewer cross-user playback and reactions', async () => {
  const createStoryCode = await readFile(
    new URL('../src/components/CreateStoryModal.jsx', import.meta.url),
    'utf8'
  );
  const storyViewerCode = await readFile(
    new URL('../src/components/StoryViewer.jsx', import.meta.url),
    'utf8'
  );
  const mediaServiceCode = await readFile(
    new URL('../src/services/mediaService.js', import.meta.url),
    'utf8'
  );

  // 1. CreateStoryModal provides live camera viewfinder & Telegram-style editor
  assert.match(createStoryCode, /getUserMedia/);
  assert.match(createStoryCode, /facingMode/);
  assert.match(createStoryCode, /handleCapturePhoto/);
  assert.match(createStoryCode, /story-shutter-btn/);
  assert.match(createStoryCode, /story-caption-pill/);
  assert.match(createStoryCode, /24 часа/);

  // 2. StoryViewer provides cross-user continuous playback, reactions, and owner actions
  assert.match(storyViewerCode, /groupedUsers/);
  assert.match(storyViewerCode, /currentUserGroupIndex/);
  assert.match(storyViewerCode, /story-reactions-row/);
  assert.match(storyViewerCode, /story-reply-form/);
  assert.match(storyViewerCode, /deleteStory/);
  assert.match(storyViewerCode, /story-owner-bar/);

  // 3. mediaService provides deleteStory capability
  assert.match(mediaServiceCode, /deleteStory:\s*async/);
});

test('Mobile Tactility: multi-tier haptics engine, user settings toggle, and active touch micro-interactions', async () => {
  const {
    triggerHaptic,
    isHapticsEnabled,
    setHapticsEnabled,
    HAPTIC_LIGHT,
    HAPTIC_MEDIUM,
    HAPTIC_HEAVY,
    HAPTIC_SUCCESS
  } = await import('../src/hooks/useMessageTouch.js');

  // 1. Validate Haptics presets & safe execution in node environment
  assert.strictEqual(typeof HAPTIC_LIGHT, 'number');
  assert.strictEqual(typeof HAPTIC_MEDIUM, 'number');
  assert.strictEqual(typeof HAPTIC_HEAVY, 'number');
  assert.ok(Array.isArray(HAPTIC_SUCCESS));
  assert.strictEqual(triggerHaptic(HAPTIC_LIGHT), false, 'Safe fallback in headless / node environment');

  // 2. Validate haptics enablement storage toggle
  setHapticsEnabled(false);
  assert.strictEqual(isHapticsEnabled(), false);
  assert.strictEqual(triggerHaptic(HAPTIC_MEDIUM), false);
  setHapticsEnabled(true);
  assert.strictEqual(isHapticsEnabled(), true);

  // 3. Verify component code contracts for haptics integration
  const chatComposerCode = await readFile(new URL('../src/components/chat/ChatComposer.jsx', import.meta.url), 'utf8');
  const sidebarCode = await readFile(new URL('../src/components/Sidebar.jsx', import.meta.url), 'utf8');
  const chatHeaderCode = await readFile(new URL('../src/components/chat/ChatHeader.jsx', import.meta.url), 'utf8');
  const mediaPickerCode = await readFile(new URL('../src/components/chat/MediaPickerPanel.jsx', import.meta.url), 'utf8');
  const notificationsTabCode = await readFile(new URL('../src/components/settings/NotificationsTab.jsx', import.meta.url), 'utf8');
  const swipeGestureCode = await readFile(new URL('../src/hooks/useSwipeGesture.js', import.meta.url), 'utf8');
  const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(chatComposerCode, /triggerHaptic\(15\)/, 'ChatComposer dispatches haptic on send');
  assert.match(chatComposerCode, /triggerHaptic\(25\)/, 'ChatComposer dispatches haptic on record pointer down');
  assert.match(sidebarCode, /triggerHaptic\(8\)/, 'Sidebar dispatches haptic on chat click');
  assert.match(chatHeaderCode, /triggerHaptic\(10\)/, 'ChatHeader dispatches haptic on back click');
  assert.match(mediaPickerCode, /triggerHaptic\(6\)/, 'MediaPickerPanel dispatches haptic on emoji click');
  assert.match(notificationsTabCode, /Тактильный отклик/, 'NotificationsTab has Tactility/Haptics toggle');
  assert.match(swipeGestureCode, /triggerHaptic\(12\)/, 'Edge swipe back dispatches haptic');
  assert.match(indexCss, /touch-action:\s*manipulation/, 'CSS enforces touch-action: manipulation');
  const sidebarCss = await readFile(new URL('../src/components/Sidebar.css', import.meta.url), 'utf8');
  assert.match(sidebarCss, /\.chat-item:active/, 'Chat rows provide pressed feedback');
  assert.doesNotMatch(sidebarCss, /transform:\s*scale/, 'Press feedback preserves row dimensions');
});

test('Chat Instant Opening: IndexedDB caching, Stale-While-Revalidate seamless merge, smart prewarming, and Telegram shimmer skeleton', async () => {
  const {
    saveCachedMessages,
    getCachedMessages,
    clearCachedMessages
  } = await import('../src/utils/indexedDbHelper.js');

  // 1. Safe execution in Node/headless environment
  assert.strictEqual(typeof saveCachedMessages, 'function');
  assert.strictEqual(typeof getCachedMessages, 'function');
  assert.strictEqual(typeof clearCachedMessages, 'function');

  // In Node environment without indexedDB global, helpers gracefully return without throwing
  await saveCachedMessages('chat-1', [{ id: 'm1', text: 'Hello', timestamp: new Date() }]);
  const result = await getCachedMessages('chat-1');
  assert.strictEqual(result, null);
  await clearCachedMessages('chat-1');

  // 2. Component contracts verification
  const useChatLoaderCode = await readFile(new URL('../src/context/chat/useChatLoader.js', import.meta.url), 'utf8');
  const chatAreaCode = await readFile(new URL('../src/components/ChatArea.jsx', import.meta.url), 'utf8');
  const chatSkeletonCode = await readFile(new URL('../src/components/chat/ChatSkeleton.jsx', import.meta.url), 'utf8');
  const chatSkeletonCss = await readFile(new URL('../src/components/chat/ChatSkeleton.css', import.meta.url), 'utf8');

  // Verify Stale-While-Revalidate & Smart Pre-warming in useChatLoader
  assert.match(useChatLoaderCode, /getCachedMessages/, 'useChatLoader loads from IndexedDB cache immediately');
  assert.match(useChatLoaderCode, /saveCachedMessages/, 'useChatLoader persists messages to IndexedDB');
  assert.match(useChatLoaderCode, /prewarmTopChats/, 'useChatLoader implements smart pre-warming of top chats');
  assert.match(useChatLoaderCode, /isChatLoading/, 'useChatLoader exposes isChatLoading state map');

  // Verify ChatArea integrates ChatSkeleton
  assert.match(chatAreaCode, /import ChatSkeleton/, 'ChatArea imports ChatSkeleton');
  assert.match(chatAreaCode, /isInitialLoading\s*\?\s*\(\s*<ChatSkeleton/, 'ChatArea renders ChatSkeleton during initial cold load');
  assert.match(chatAreaCode, /if\s*\(isInitialLoading\)\s*return/, 'useLayoutEffect defers scroll measurement until skeleton finishes');

  // Verify Telegram-style Shimmer Skeleton layout & animations
  assert.match(chatSkeletonCode, /skeleton-bubble/, 'ChatSkeleton defines bubble placeholders');
  assert.match(chatSkeletonCode, /shimmer/, 'ChatSkeleton includes shimmer class');
  assert.match(chatSkeletonCss, /@keyframes telegramShimmer/, 'ChatSkeleton.css implements telegramShimmer animation');
  assert.match(chatSkeletonCss, /border-radius:\s*16px 16px 16px 4px/, 'ChatSkeleton implements Telegram incoming bubble curvature');
});
