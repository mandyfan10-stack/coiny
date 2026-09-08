import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  normalizeCachedMessage,
  denormalizeCachedMessage
} from '../src/utils/indexedDbHelper.js';

const indexedDbHelperCode = await readFile(
  new URL('../src/utils/indexedDbHelper.js', import.meta.url),
  'utf8'
);
const useChatLoaderCode = await readFile(
  new URL('../src/context/chat/useChatLoader.js', import.meta.url),
  'utf8'
);
const useChatRealtimeCode = await readFile(
  new URL('../src/context/chat/useChatRealtime.js', import.meta.url),
  'utf8'
);
const useChatActionsCode = await readFile(
  new URL('../src/context/chat/useChatActions.js', import.meta.url),
  'utf8'
);
const privateStorageImageCode = await readFile(
  new URL('../src/components/PrivateStorageImage.jsx', import.meta.url),
  'utf8'
);
const chatHeaderCode = await readFile(
  new URL('../src/components/chat/ChatHeader.jsx', import.meta.url),
  'utf8'
);
const appearanceTabCode = await readFile(
  new URL('../src/components/settings/AppearanceTab.jsx', import.meta.url),
  'utf8'
);
const useResolvedMediaCode = await readFile(
  new URL('../src/hooks/useResolvedMedia.js', import.meta.url),
  'utf8'
);
const useOfflineSyncCode = await readFile(
  new URL('../src/context/chat/useOfflineSync.js', import.meta.url),
  'utf8'
);
const chatAreaCode = await readFile(
  new URL('../src/components/ChatArea.jsx', import.meta.url),
  'utf8'
);
const sidebarCode = await readFile(
  new URL('../src/components/Sidebar.jsx', import.meta.url),
  'utf8'
);

test('normalizeCachedMessage and denormalizeCachedMessage convert timestamps and preserve message fields', () => {
  const original = {
    id: 'msg-123',
    chatId: 'chat-abc',
    senderId: 'user-1',
    senderName: 'Alice',
    text: 'Привет, как дела?',
    media: null,
    replyTo: 'msg-120',
    read: true,
    reads: ['user-2'],
    reactions: [{ emoji: '🔥', count: 1, users: ['user-2'] }],
    timestamp: new Date('2026-09-05T12:00:00Z'),
    isPending: false,
    isOptimistic: false
  };

  const normalized = normalizeCachedMessage(original, 'chat-abc', 'user-1');
  assert.equal(normalized.id, 'msg-123');
  assert.equal(normalized.chatId, 'chat-abc');
  assert.equal(normalized.text, 'Привет, как дела?');
  assert.equal(normalized.timestampIso, '2026-09-05T12:00:00.000Z');
  assert.equal(normalized.read, true);
  assert.deepEqual(normalized.reads, ['user-2']);

  const roundtripped = denormalizeCachedMessage(normalized);
  assert.equal(roundtripped.id, 'msg-123');
  assert.ok(roundtripped.timestamp instanceof Date);
  assert.equal(roundtripped.timestamp.toISOString(), '2026-09-05T12:00:00.000Z');
});

test('indexedDbHelper defines schema version 8 and v2 cache stores with proper indexes', () => {
  assert.match(indexedDbHelperCode, /const DB_VERSION\s*=\s*8/);
  assert.match(indexedDbHelperCode, /const MESSAGES_CACHE_V2_STORE_NAME\s*=\s*'messages-cache-v2'/);
  assert.match(indexedDbHelperCode, /const CHATS_CACHE_STORE_NAME\s*=\s*'chats-cache'/);
  assert.match(indexedDbHelperCode, /const MEDIA_CACHE_STORE_NAME\s*=\s*'media-cache'/);

  // Store creation and index checks
  assert.match(indexedDbHelperCode, /by-chat-timestamp/);
  assert.match(indexedDbHelperCode, /by-chat/);
  assert.match(indexedDbHelperCode, /by-accessed/);

  // V2 exports check
  assert.match(indexedDbHelperCode, /export async function saveCachedMessage\(/);
  assert.match(indexedDbHelperCode, /export async function saveCachedMessagesBatch\(/);
  assert.match(indexedDbHelperCode, /export async function getCachedMessagesForChat\(/);
  assert.match(indexedDbHelperCode, /export async function deleteCachedMessage\(/);
  assert.match(indexedDbHelperCode, /export async function updateCachedMessageFields\(/);
  assert.match(indexedDbHelperCode, /export async function saveCachedChatList\(/);
  assert.match(indexedDbHelperCode, /export async function getCachedChatList\(/);
  assert.match(indexedDbHelperCode, /export async function saveCachedMedia\(/);
  assert.match(indexedDbHelperCode, /export async function getCachedMedia\(/);
  assert.match(indexedDbHelperCode, /export async function clearMediaAndMessageCache\(/);
  assert.match(indexedDbHelperCode, /export async function getCacheStorageStats\(/);
});

test('useChatLoader implements instant 0ms chat list startup and SWR message hydration', () => {
  assert.match(useChatLoaderCode, /getCachedChatList\(currentUserId\)/);
  assert.match(useChatLoaderCode, /saveCachedChatList\(updatedChats,\s*currentUserId\)/);
  assert.match(useChatLoaderCode, /getCachedMessagesForChat\(activeChatId,\s*currentUserId\)/);
  assert.match(useChatLoaderCode, /saveCachedMessagesBatch\(chatId,\s*finalMessages,\s*currentUserId\)/);
  assert.match(useChatLoaderCode, /isSyncing/);
});

test('useChatRealtime immediately updates IndexedDB cache on INSERT, UPDATE, and DELETE', () => {
  assert.match(useChatRealtimeCode, /saveCachedMessage\(formattedMsg,\s*newMsg\.chat_id,\s*currentUser\.id\)/);
  assert.match(useChatRealtimeCode, /deleteCachedMessage\(deletedMsgId\)/);
  assert.match(useChatRealtimeCode, /updateCachedMessageFields\(updatedMsg\.id/);
  assert.match(useChatRealtimeCode, /updateCachedMessageFields\(receipt\.message_id/);
});

test('useChatActions writes optimistic and confirmed messages to cache', () => {
  assert.match(useChatActionsCode, /saveCachedMessage\(optimisticMsg,\s*activeChatId,\s*currentUser\.id\)/);
  assert.match(useChatActionsCode, /deleteCachedMessage\(messageId\)/);
  assert.match(useChatActionsCode, /updateCachedMessageFields\(messageId,\s*\{\s*reactions:/);
  assert.match(useChatActionsCode, /updateCachedMessageFields\(m\.id,\s*\{\s*read:\s*true\s*\}\)/);
});

test('PrivateStorageImage checks media-cache before hitting Supabase storage and caches result', () => {
  assert.match(privateStorageImageCode, /getCachedMedia\(cacheKey\)/);
  assert.match(privateStorageImageCode, /saveCachedMedia\(cacheKey,\s*data/);
});

test('ChatHeader renders Telegram-style syncing status when background revalidation occurs', () => {
  assert.match(chatHeaderCode, /isSyncing/);
  assert.match(chatHeaderCode, /Обновление\.\.\./);
});

test('AppearanceTab renders Storage and Data section with cache size and clear cache button', () => {
  assert.match(appearanceTabCode, /Память и данные/);
  assert.match(appearanceTabCode, /cacheStats/);
  assert.match(appearanceTabCode, /clearMediaAndMessageCache/);
  assert.match(appearanceTabCode, /Очистить кэш/);
});

test('useResolvedMedia integrates persistent IndexedDB media caching for instant offline playback', () => {
  assert.match(useResolvedMediaCode, /getCachedMedia\(cacheKey\)/);
  assert.match(useResolvedMediaCode, /saveCachedMedia\(cacheKey,\s*finalBlob/);
  assert.match(useResolvedMediaCode, /!navigator\.onLine/);
});

test('indexedDbHelper provides getCachedMessagesBeforeTimestamp and non-blocking readonly getCachedMedia', () => {
  assert.match(indexedDbHelperCode, /export async function getCachedMessagesBeforeTimestamp\(/);
  assert.match(indexedDbHelperCode, /db\.transaction\(MEDIA_CACHE_STORE_NAME,\s*'readonly'\)/);
  assert.match(indexedDbHelperCode, /queueTouchMediaAccess/);
});

test('useChatLoader preserves older history on SWR merge and supports local pagination', () => {
  assert.match(useChatLoaderCode, /olderHistory/);
  assert.match(useChatLoaderCode, /getCachedMessagesBeforeTimestamp\(chatId,\s*oldestTimestamp/);
  // Must not have the 5-message trap
  assert.ok(!useChatLoaderCode.includes('(currentChat?.messages?.length || 0) > 1'));
});

test('message confirmation updates isOptimistic status in IndexedDB across actions, realtime, and offline sync', () => {
  assert.match(useChatActionsCode, /updateCachedMessageFields\(messageId,\s*\{\s*isOptimistic:\s*false,\s*isPending:\s*false\s*\}\)/);
  assert.match(useChatRealtimeCode, /updateCachedMessageFields\(newMsg\.id,\s*\{\s*isOptimistic:\s*false/);
  assert.match(useOfflineSyncCode, /saveCachedMessage\(\{[\s\S]*?id:\s*data\.id[\s\S]*?isOptimistic:\s*false/);
});

test('ChatArea and Sidebar calculate unread status and divider accurately', () => {
  assert.match(chatAreaCode, /firstUnreadIndex/);
  assert.match(chatAreaCode, /findIndex\(\(m\)\s*=>\s*m\.senderId\s*!==\s*currentUser\?\.id/);
  assert.match(sidebarCode, /typeof chat\.unread_count === 'number'/);
});

