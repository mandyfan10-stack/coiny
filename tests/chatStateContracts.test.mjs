import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatLoader = readFileSync(new URL('../src/context/chat/useChatLoader.js', import.meta.url), 'utf8');
const chatRealtime = readFileSync(new URL('../src/context/chat/useChatRealtime.js', import.meta.url), 'utf8');
const chatService = readFileSync(new URL('../src/services/chatService.js', import.meta.url), 'utf8');
const latestMessagesMigration = readFileSync(new URL('../supabase/migrations/20260726144500_get_latest_chat_messages.sql', import.meta.url), 'utf8');

test('chat list refresh preserves an already loaded message history', () => {
  assert.doesNotMatch(chatLoader, /setChats\(updatedChats\)/);
  assert.match(chatLoader, /existingChat\?\.messages\?\.length/);
  assert.match(chatLoader, /missingPreviewMessages/);
  assert.match(chatLoader, /messages: \[\.\.\.existingMessages, \.\.\.missingPreviewMessages\]/);
});

test('active encrypted chat reloads after the private key becomes available', () => {
  assert.match(
    chatLoader,
    /\[activeChatId, e2eePrivateKey, isCurrentSession, loadActiveChatMessages\]/,
  );
});

test('read receipts survive reload and update senders in realtime', () => {
  assert.match(chatService, /\.rpc\('get_latest_chat_messages'/);
  assert.doesNotMatch(chatService, /latestMsgPromises/);
  assert.match(chatService, /latestMsg\.read_by/);
  assert.match(chatRealtime, /table:\s*'message_reads'/);
  assert.match(chatRealtime, /message\.id === receipt\.message_id/);
});
test('latest-message RPC is batched and keeps caller RLS', () => {
  assert.match(latestMessagesMigration, /security invoker/i);
  assert.match(latestMessagesMigration, /distinct on \(message\.chat_id\)/i);
  assert.match(latestMessagesMigration, /revoke execute[\s\S]*from public, anon/i);
  assert.match(latestMessagesMigration, /grant execute[\s\S]*to authenticated/i);
});

test('chat list load does not auto-join every public channel', () => {
  assert.match(chatService, /const CHAT_SELECT = 'id, name, type/);
  assert.doesNotMatch(chatService, /Failed to auto-join public chat/);
  assert.doesNotMatch(chatService, /from\('chats'\)\s*\.select\('\*'\)/);
});

test('startup chat bootstrap is not retriggered by realtime chat-id changes', () => {
  assert.equal((chatRealtime.match(/useEffect\(/g) || []).length, 2);
  assert.match(chatRealtime, /Do not tie this to[\s\S]*realtimeChatIds/);
  assert.match(chatRealtime, /\[currentUserId, fetchChats, fetchStories\]/);
  assert.doesNotMatch(chatRealtime, /if \(currentUser\) \{\s*fetchChats\(\);\s*fetchStories\(\);/);
});

test('presence uses auth ids and typing expiry is isolated per chat and cleaned up', () => {
  assert.match(chatRealtime, /presence:\s*\{\s*key:\s*currentUser\.id\s*\}/);
  assert.match(chatRealtime, /const timeoutKey = `\$\{chatId\}:\$\{userId\}`/);
  assert.match(chatRealtime, /Object\.values\(typingTimeoutsRef\.current\)/);
  assert.match(chatRealtime, /typingTimeoutsRef\.current = \{\}/);
});
