import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authContext = await readFile(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8');
const authService = await readFile(new URL('../src/services/authService.js', import.meta.url), 'utf8');
const authEmail = await readFile(new URL('../src/services/authEmail.ts', import.meta.url), 'utf8');
const dataLayer = await readFile(new URL('../src/services/dataLayer.js', import.meta.url), 'utf8');
const settingsModal = await readFile(new URL('../src/components/SettingsModal.jsx', import.meta.url), 'utf8');
const e2eeTab = await readFile(new URL('../src/components/settings/E2EETab.jsx', import.meta.url), 'utf8');
const authScreen = await readFile(new URL('../src/components/AuthScreen.jsx', import.meta.url), 'utf8');
const e2eHelpers = await readFile(new URL('./e2e/helpers.mjs', import.meta.url), 'utf8');

test('auth state callbacks do not await Supabase profile calls directly', () => {
  assert.doesNotMatch(authContext, /onAuthStateChange\s*\(\s*async/);
  assert.match(authContext, /auth\.getSession\(\)/);
  assert.match(authContext, /AUTH_BOOTSTRAP_TIMEOUT_MS/);
  assert.match(authContext, /AUTH_PROFILE_TIMEOUT_MS/);
  assert.match(authContext, /setTimeout\(async \(\) =>/);
  assert.match(authContext, /retryAuthProfile/);
  assert.match(authContext, /setAuthError/);
  const listenerStart = authContext.indexOf('onAuthStateChange');
  assert.ok(listenerStart > 0);
  assert.doesNotMatch(authContext.slice(listenerStart, listenerStart + 280), /getSession/);
  assert.match(authService, /\.maybeSingle\(\)/);
  assert.match(dataLayer, /fetchProfile:\s*authService\.fetchProfile/);
  assert.match(authContext, /email: session\.user\.email/);
  assert.match(authContext, /auth\.updateUser\(\{ email:/);
});

test('email is exposed and editable from settings', () => {
  assert.match(settingsModal, /updateEmail/);
  assert.match(e2eeTab, /id="settings-email-input"/);
});

test('auth uses dual-path internal emails without hardcoding only tg-clone on signup', () => {
  assert.match(authService, /validateAuthEmail/);
  assert.match(authService, /email: validated\.email/);
  assert.match(authService, /buildSignupAuthEmail/);
  assert.match(authService, /buildSignInEmailCandidates/);
  assert.match(authService, /shouldTryNextAuthEmail/);
  assert.match(authService, /mapSupabaseAuthError/);
  assert.match(authService, /resolve_username_auth_email/);
  assert.match(authService, /authService\.signIn\(cleanUsername, password\)/);
  assert.match(authEmail, /coiny\.users\.local/);
  assert.match(authEmail, /tg-clone\.com/);
  assert.match(authEmail, /email_not_confirmed/);
  assert.doesNotMatch(authService, /\$\{username\}@tg-clone\.com/);
  assert.doesNotMatch(authService, /status === 400/);
  assert.match(authService, /passwordHash/);
  assert.match(authService, /hashMockPassword/);
});

test('live E2E login targets the current identifier input contract', () => {
  assert.match(authScreen, /id=\{isLogin \? 'loginIdentifier' : 'username'\}/);
  assert.match(e2eHelpers, /page\.locator\('#loginIdentifier'\)/);
  assert.doesNotMatch(e2eHelpers, /page\.locator\('#username'\)/);
});
