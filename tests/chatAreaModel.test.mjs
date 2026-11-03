import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECORDING_BYTES,
  clampMatchIndex,
  countUnreadMessages,
  cycleMatchIndex,
  findMessageMatches,
  formatDateDivider,
  formatRecordDuration,
  formatTypingText,
  getAttachmentCaption,
  getChatBodyStyle,
  getChatPermissions,
  getFirstUnreadIndex,
  getRecordGesture,
  getRecordingCaption,
  getRecordingConstraints,
  getRecordingMediaType,
  isCustomWallpaper,
  isFindShortcut,
  isPastableMediaType,
  needsDateDivider,
  shouldCloseMessageActions,
  shouldCloseRetryMenu,
  toggleRecordMode,
} from '../src/components/chat/chatAreaModel.ts';

// ---------------------------------------------------------------- permissions

test('personal chats always allow posting and media', () => {
  assert.deepEqual(getChatPermissions({ type: 'personal', createdBy: 'other' }, 'me'), { isOwner: false, canPost: true, canSendMedia: true });
});

test('group posting honours only_admins_can_post for non-owners', () => {
  const restricted = { type: 'group', createdBy: 'admin', settings: { only_admins_can_post: true } };
  assert.equal(getChatPermissions(restricted, 'member').canPost, false);
  assert.equal(getChatPermissions(restricted, 'admin').canPost, true);
  assert.equal(getChatPermissions({ ...restricted, createdBy: 'current' }, 'me').isOwner, true, 'mock-mode owner marker');
  assert.equal(getChatPermissions({ type: 'group', createdBy: 'admin' }, 'member').canPost, true);
});

test('channels are owner-only and media can be disabled for members', () => {
  assert.equal(getChatPermissions({ type: 'channel', createdBy: 'owner' }, 'reader').canPost, false);
  assert.equal(getChatPermissions({ type: 'channel', createdBy: 'owner' }, 'owner').canPost, true);
  const noMedia = { type: 'group', createdBy: 'admin', settings: { allow_media: false } };
  assert.equal(getChatPermissions(noMedia, 'member').canSendMedia, false);
  assert.equal(getChatPermissions(noMedia, 'admin').canSendMedia, true);
});

test('a chat that requires a client update blocks posting entirely', () => {
  assert.equal(getChatPermissions({ type: 'personal', requiresUpdate: true }, 'me').canPost, false);
});

test('no user id means no ownership', () => {
  assert.equal(getChatPermissions({ type: 'group', createdBy: undefined }, undefined).isOwner, false);
});

// ------------------------------------------------------------------ wallpaper

test('built-in wallpapers paint nothing; custom ones are prioritised over themes', () => {
  for (const builtIn of [null, '', 'classic', 'default']) {
    assert.equal(isCustomWallpaper(builtIn), false, String(builtIn));
    assert.deepEqual(getChatBodyStyle(builtIn, 'blob:ignored'), {});
  }
  assert.equal(isCustomWallpaper('storage://public-media/u/w.webp'), true);
});

test('direct wallpaper URLs paint immediately and cover the chat body', () => {
  for (const url of ['https://cdn.test/w.webp', 'http://cdn.test/w.png', 'data:image/png;base64,AA', 'blob:abc']) {
    assert.deepEqual(getChatBodyStyle(url, null), {
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    });
  }
});

test('storage wallpaper references are never painted raw, only once resolved', () => {
  const reference = 'storage://public-media/u/w.webp';
  assert.equal(getChatBodyStyle(reference, null).backgroundImage, 'none');
  assert.equal(getChatBodyStyle(reference, 'blob:resolved').backgroundImage, 'url("blob:resolved")');
});

// --------------------------------------------------------------------- search

const messages = [
  { id: '1', text: 'Hello World' },
  { id: '2', text: null },
  { id: '3', text: 'another hello' },
  { id: '4', text: 'Привет' },
];

test('search matches trimmed, case-insensitive text and skips media-only messages', () => {
  assert.deepEqual(findMessageMatches(messages, '  HELLO ').map(m => m.id), ['1', '3']);
  assert.deepEqual(findMessageMatches(messages, 'привет').map(m => m.id), ['4']);
  assert.deepEqual(findMessageMatches(messages, '   '), []);
  assert.deepEqual(findMessageMatches(undefined, 'hello'), []);
});

test('match navigation wraps in both directions', () => {
  assert.equal(cycleMatchIndex(0, 3, 1), 1);
  assert.equal(cycleMatchIndex(2, 3, 1), 0);
  assert.equal(cycleMatchIndex(0, 3, -1), 2);
  assert.equal(cycleMatchIndex(0, 0, 1), 0);
});

test('the selected match stays in range when results shrink', () => {
  assert.equal(clampMatchIndex(4, 2), 1);
  assert.equal(clampMatchIndex(1, 2), 1);
  assert.equal(clampMatchIndex(3, 0), 0);
});

test('Ctrl/Cmd+F opens search on both Latin and Russian layouts', () => {
  for (const key of ['f', 'F', 'а', 'А']) {
    assert.equal(isFindShortcut({ ctrlKey: true, key }), true, key);
    assert.equal(isFindShortcut({ metaKey: true, key }), true, key);
  }
  assert.equal(isFindShortcut({ key: 'f' }), false);
  assert.equal(isFindShortcut({ ctrlKey: true, key: 'g' }), false);
});

// ------------------------------------------------------------ unread & dates

test('the unread divider uses the server counter when present', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.equal(getFirstUnreadIndex(list, 2, 'me'), 2);
});

test('without a counter the divider sits at the first unread incoming message', () => {
  const list = [
    { id: 'a', senderId: 'them', read: true },
    { id: 'b', senderId: 'me', read: false },
    { id: 'c', senderId: 'current', read: false },
    { id: 'd', senderId: 'them', read: false },
  ];
  assert.equal(getFirstUnreadIndex(list, undefined, 'me'), 3, 'own messages never count as unread');
  assert.equal(getFirstUnreadIndex(list, 0, 'me'), 3, 'a zero counter falls back to read flags');
  assert.equal(getFirstUnreadIndex(list.slice(0, 3), undefined, 'me'), -1);
  assert.equal(countUnreadMessages({ messages: list }, 'me'), 1);
  assert.equal(countUnreadMessages({ messages: list, unread_count: 7 }, 'me'), 7);
  assert.equal(countUnreadMessages(null, 'me'), 0);
});

test('date dividers appear at the first message and on each day change', () => {
  const morning = { id: '1', timestamp: '2026-11-02T08:00:00' };
  const evening = { id: '2', timestamp: '2026-11-02T21:00:00' };
  const nextDay = { id: '3', timestamp: '2026-11-03T08:00:00' };
  assert.equal(needsDateDivider(undefined, morning), true);
  assert.equal(needsDateDivider(morning, evening), false);
  assert.equal(needsDateDivider(evening, nextDay), true);
});

test('date dividers read today, yesterday, then a localized date', () => {
  const now = new Date('2026-11-03T12:00:00');
  assert.equal(formatDateDivider('2026-11-03T01:00:00', now), 'Сегодня');
  assert.equal(formatDateDivider('2026-11-02T23:59:00', now), 'Вчера');
  assert.equal(formatDateDivider('2026-10-15T10:00:00', now), '15 октября');
  assert.equal(formatDateDivider('2025-10-15T10:00:00', now), '15 октября 2025 г.');
  assert.equal(formatDateDivider('not a date', now), null);
  assert.equal(formatDateDivider(null, now), null);
});

// --------------------------------------------------------------------- typing

test('typing indicator pluralises and is absent when nobody types', () => {
  assert.equal(formatTypingText([]), null);
  assert.equal(formatTypingText(['Аня']), 'Аня печатает...');
  assert.equal(formatTypingText(['Аня', 'Боб']), 'Аня, Боб печатают...');
});

// ------------------------------------------------------------ outside clicks

const targetInside = (...selectors) => ({ closest: selector => (selectors.includes(selector) ? {} : null) });

test('clicks inside portaled message menus and the mobile action sheet keep them open', () => {
  for (const selector of ['.message-hover-actions', '.reaction-drawer', '.mobile-action-sheet', '.mobile-action-sheet-backdrop']) {
    assert.equal(shouldCloseMessageActions(targetInside(selector)), false, selector);
  }
  assert.equal(shouldCloseMessageActions(targetInside('.chat-body')), true);
});

test('the failed-message retry menu stays open for clicks on itself or its status icon', () => {
  assert.equal(shouldCloseRetryMenu(targetInside('.failed-message-menu')), false);
  assert.equal(shouldCloseRetryMenu(targetInside('.seen-check.failed')), false);
  assert.equal(shouldCloseRetryMenu(targetInside('.message-hover-actions')), true);
});

// ------------------------------------------------------------------ recording

test('swiping left while holding cancels; drifting too far vertically does not', () => {
  assert.deepEqual(getRecordGesture({ diffX: 120, diffY: 10, isLockActive: false }), { type: 'cancel' });
  assert.notDeepEqual(getRecordGesture({ diffX: 120, diffY: 50, isLockActive: false }), { type: 'cancel' });
  assert.deepEqual(getRecordGesture({ diffX: 90, diffY: 0, isLockActive: false }), { type: 'none' });
});

test('swiping up arms the lock and dropping back below 30px disarms it', () => {
  assert.deepEqual(getRecordGesture({ diffX: 0, diffY: 90, isLockActive: false }), { type: 'lock-hint', active: true });
  assert.deepEqual(getRecordGesture({ diffX: 0, diffY: 50, isLockActive: true }), { type: 'none' }, 'hysteresis between 30 and 80px');
  assert.deepEqual(getRecordGesture({ diffX: 0, diffY: 10, isLockActive: true }), { type: 'lock-hint', active: false });
  assert.deepEqual(getRecordGesture({ diffX: 0, diffY: 10, isLockActive: false }), { type: 'none' });
});

test('recording modes, constraints and captions', () => {
  assert.equal(toggleRecordMode('voice'), 'video');
  assert.equal(toggleRecordMode('video'), 'voice');
  assert.deepEqual(getRecordingConstraints('voice'), { audio: true, video: false });
  assert.equal(getRecordingConstraints('video').video.facingMode, 'user');
  assert.equal(getRecordingMediaType('voice'), 'audio');
  assert.equal(getRecordingMediaType('video'), 'video');
  assert.equal(getRecordingCaption('voice'), 'Голосовое сообщение');
  assert.equal(getRecordingCaption('video'), 'Видеосообщение');
  assert.equal(MAX_RECORDING_BYTES, 15 * 1024 * 1024);
});

test('recording duration is shown as m:ss', () => {
  assert.equal(formatRecordDuration(0), '0:00');
  assert.equal(formatRecordDuration(9), '0:09');
  assert.equal(formatRecordDuration(75), '1:15');
});

// ------------------------------------------------------------- attachments

test('attachment captions and pastable clipboard types', () => {
  assert.equal(getAttachmentCaption('audio'), 'Голосовое сообщение');
  assert.equal(getAttachmentCaption('video'), '🎬 [Видео]');
  assert.equal(getAttachmentCaption('image'), 'Изображение');
  assert.equal(isPastableMediaType('image/png'), true);
  assert.equal(isPastableMediaType('video/mp4'), true);
  assert.equal(isPastableMediaType('audio/ogg'), true);
  assert.equal(isPastableMediaType('text/plain'), false);
  assert.equal(isPastableMediaType('application/pdf'), false);
});
