import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanInviteIdentifier,
  getAppBaseUrl,
  buildInviteLink,
  parseInviteParam,
  clearInviteParamFromUrl,
  savePendingInvite,
  getPendingInvite,
  clearPendingInvite
} from '../src/utils/inviteLink.js';

const profileTabSource = readFileSync(new URL('../src/components/settings/ProfileTab.jsx', import.meta.url), 'utf8');
const settingsModalSource = readFileSync(new URL('../src/components/SettingsModal.jsx', import.meta.url), 'utf8');
const chatInfoSource = readFileSync(new URL('../src/components/ChatInfo.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const authScreenSource = readFileSync(new URL('../src/components/AuthScreen.jsx', import.meta.url), 'utf8');
const useInviteHandlerSource = readFileSync(new URL('../src/hooks/useInviteHandler.js', import.meta.url), 'utf8');
const chatActionsSource = readFileSync(new URL('../src/context/chat/useChatActions.js', import.meta.url), 'utf8');
const chatServiceSource = readFileSync(new URL('../src/services/chatService.js', import.meta.url), 'utf8');
const dataLayerSource = readFileSync(new URL('../src/services/dataLayer.js', import.meta.url), 'utf8');
const chatProviderSource = readFileSync(new URL('../src/context/chat/ChatProvider.jsx', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../supabase/migrations/20260912120000_join_chat_by_invite.sql', import.meta.url), 'utf8');

test('cleanInviteIdentifier strips @, whitespace, and handles edge cases', () => {
  assert.equal(cleanInviteIdentifier('@monetka'), 'monetka');
  assert.equal(cleanInviteIdentifier('@@monetka'), 'monetka');
  assert.equal(cleanInviteIdentifier('  @monetka  '), 'monetka');
  assert.equal(cleanInviteIdentifier('user_123'), 'user_123');
  assert.equal(cleanInviteIdentifier('%40alex'), 'alex');
  assert.equal(cleanInviteIdentifier(''), null);
  assert.equal(cleanInviteIdentifier('   '), null);
  assert.equal(cleanInviteIdentifier('@'), null);
  assert.equal(cleanInviteIdentifier('@@@'), null);
  assert.equal(cleanInviteIdentifier(null), null);
  assert.equal(cleanInviteIdentifier(undefined), null);
});

test('getAppBaseUrl returns clean URL with fallback', () => {
  const fallback = getAppBaseUrl();
  assert.ok(typeof fallback === 'string');
  assert.ok(!fallback.endsWith('/'));
  assert.ok(!fallback.endsWith('index.html'));
});

test('buildInviteLink generates valid invite URL', () => {
  const link1 = buildInviteLink('monetka');
  assert.match(link1, /\/\?invite=monetka$/);

  const link2 = buildInviteLink('@alex_dev');
  assert.match(link2, /\/\?invite=alex_dev$/);

  const linkEmpty = buildInviteLink('');
  assert.equal(linkEmpty, '');

  const linkNull = buildInviteLink(null);
  assert.equal(linkNull, '');
});

test('parseInviteParam extracts invite and start from search and hash', () => {
  // Search params: ?invite=...
  assert.equal(parseInviteParam({ search: '?invite=monetka', hash: '' }), 'monetka');
  assert.equal(parseInviteParam({ search: '?invite=@monetka', hash: '' }), 'monetka');
  assert.equal(parseInviteParam({ search: '?start=alice', hash: '' }), 'alice');

  // Hash params: #invite=...
  assert.equal(parseInviteParam({ search: '', hash: '#invite=bob' }), 'bob');
  assert.equal(parseInviteParam({ search: '', hash: '#/invite/charlie' }), 'charlie');
  assert.equal(parseInviteParam({ search: '', hash: '#/start/david' }), 'david');
  assert.equal(parseInviteParam({ search: '', hash: '#start=eve' }), 'eve');

  // Both search and hash - search takes priority or matches
  assert.equal(parseInviteParam({ search: '?invite=monetka', hash: '#invite=bob' }), 'monetka');

  // Empty or unrelated
  assert.equal(parseInviteParam({ search: '', hash: '' }), null);
  assert.equal(parseInviteParam({ search: '?other=123', hash: '#section' }), null);
  assert.equal(parseInviteParam(null), null);
});

test('savePendingInvite, getPendingInvite, and clearPendingInvite lifecycle', () => {
  // Setup mock sessionStorage
  const storage = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  };

  try {
    assert.equal(getPendingInvite(), null);

    savePendingInvite('@monetka');
    assert.equal(getPendingInvite(), 'monetka');

    savePendingInvite('alex_dev');
    assert.equal(getPendingInvite(), 'alex_dev');

    clearPendingInvite();
    assert.equal(getPendingInvite(), null);
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('clearInviteParamFromUrl removes invite/start params via replaceState', () => {
  let replacedUrl = null;
  globalThis.window = {
    location: {
      href: 'https://mandyfan10-stack.github.io/coingram-chat/?invite=monetka&theme=dark#invite=monetka',
      search: '?invite=monetka&theme=dark',
      hash: '#invite=monetka',
      pathname: '/coingram-chat/'
    },
    history: {
      state: { key: 'val' },
      replaceState: (state, title, url) => {
        replacedUrl = url;
      }
    }
  };

  try {
    clearInviteParamFromUrl();
    assert.ok(replacedUrl !== null);
    assert.ok(!replacedUrl.includes('invite='));
    assert.ok(replacedUrl.includes('theme=dark'));
  } finally {
    delete globalThis.window;
  }
});

test('ProfileTab uses buildInviteLink without hardcoded URL', () => {
  assert.match(profileTabSource, /buildInviteLink\(currentUser\?\.username\)/);
  assert.doesNotMatch(profileTabSource, /value=\{`https:\/\/mandyfan10-stack\.github\.io/);
});

test('SettingsModal uses buildInviteLink and copyTextToClipboard', () => {
  assert.match(settingsModalSource, /buildInviteLink\(currentUser\?\.username\)/);
  assert.match(settingsModalSource, /copyTextToClipboard\(inviteLink\)/);
  assert.doesNotMatch(settingsModalSource, /const inviteLink = `https:\/\/mandyfan10-stack\.github\.io/);
});

test('ChatInfo uses buildInviteLink and copyTextToClipboard', () => {
  assert.match(chatInfoSource, /buildInviteLink\(activeChat\.username \|\| activeChat\.id\)/);
  assert.match(chatInfoSource, /copyTextToClipboard\(inviteLink\)/);
  assert.doesNotMatch(chatInfoSource, /const inviteLink = `https:\/\/mandyfan10-stack\.github\.io/);
});

test('App.jsx connects useInviteHandler and parses invite early', () => {
  assert.match(appSource, /useInviteHandler\(\{/);
  assert.match(appSource, /parseInviteParam\(\)/);
  assert.match(appSource, /savePendingInvite\(invite\)/);
  assert.match(appSource, /clearInviteParamFromUrl\(\)/);
});

test('AuthScreen renders auth-invite-banner with strictly zero emojis', () => {
  assert.match(authScreenSource, /getPendingInvite/);
  assert.match(authScreenSource, /className="auth-invite-banner"/);
  assert.match(authScreenSource, /Приглашение в диалог с/);

  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
  assert.doesNotMatch(authScreenSource, emojiRegex, 'AuthScreen must contain strictly zero emojis');
});

test('chatService returns targetUserId on personal chat creation in live and mock modes', () => {
  assert.match(chatServiceSource, /targetUserId:\s*profile\.id/);
  assert.match(chatServiceSource, /targetUserId:\s*targetUser\.id/);
});

test('useChatActions populates targetProfile fallback and exports openSavedMessages', () => {
  assert.match(chatActionsSource, /newChat\.targetUserId/);
  assert.match(chatActionsSource, /openSavedMessages,/);
});

test('useInviteHandler resolves self-invite, existing chat, and new chat creation', () => {
  assert.match(useInviteHandlerSource, /openSavedMessages/);
  assert.match(useInviteHandlerSource, /setActiveChatId\(existing\.id\)/);
  assert.match(useInviteHandlerSource, /joinChatByInvite\(target\)/);
  assert.match(useInviteHandlerSource, /createChat\(target,\s*'personal'\)/);
  assert.match(useInviteHandlerSource, /window\.addEventListener\('coiny:open-invite'/);
});

test('joinChatByInvite is wired through chatService, dataLayer, useChatActions, ChatProvider, and App.jsx', () => {
  assert.match(chatServiceSource, /joinChatByInvite:\s*async/);
  assert.match(dataLayerSource, /joinChatByInvite:\s*chatService\.joinChatByInvite/);
  assert.match(chatActionsSource, /const joinChatByInvite = useCallback/);
  assert.match(chatActionsSource, /joinChatByInvite,/);
  assert.match(chatProviderSource, /joinChatByInvite:\s*actions\.joinChatByInvite/);
  assert.match(appSource, /joinChatByInvite,/);
});

test('AuthScreen renders "Приглашение в чат" for UUID and "Приглашение в диалог с" for usernames', () => {
  assert.match(authScreenSource, /Приглашение в чат/);
  assert.match(authScreenSource, /Приглашение в диалог с/);
});

test('ChatInfo displays invite link row for groups and channels with copy button', () => {
  assert.match(chatInfoSource, /\{isGroupOrChannel\s*&&/);
  assert.match(chatInfoSource, /Ссылка-приглашение/);
  assert.match(chatInfoSource, /buildInviteLink\(activeChat\.username\s*\|\|\s*activeChat\.id\)/);
});

test('Migration 20260912120000_join_chat_by_invite.sql implements security definer function in private schema', () => {
  assert.match(migrationSource, /create or replace function private\.join_chat_by_invite/);
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /create or replace function public\.join_chat_by_invite/);
  assert.match(migrationSource, /security invoker/);
  assert.match(migrationSource, /target_chat\.type = 'channel'/);
  assert.match(migrationSource, /target_chat\.type = 'group'/);
  assert.match(migrationSource, /allow_add_members/);
  assert.match(migrationSource, /grant execute on function public\.join_chat_by_invite/);
});

test('chatService implements joinChatByInvite with live RPC and mock fallback branches', () => {
  assert.match(chatServiceSource, /joinChatByInvite:\s*async\s*\(userId,\s*rawInvite\)/);
  assert.match(chatServiceSource, /supabase\.rpc\('join_chat_by_invite',\s*\{\s*p_invite:\s*cleanInvite\s*\}\)/);
  assert.match(chatServiceSource, /localStorage\.getItem\('tg-chats-mock'\)/);
  assert.match(chatServiceSource, /existingChat\.members/);
  assert.match(chatServiceSource, /status:\s*'joined'/);
  assert.match(chatServiceSource, /createChat\(userId,\s*cleanInvite,\s*'personal'\)/);
});

