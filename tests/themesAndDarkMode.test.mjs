import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTINGS_THEMES, SETTINGS_WALLPAPERS } from '../src/components/settings/themesData.ts';

const useChatUiStateCode = await readFile(
  new URL('../src/context/chat/useChatUiState.js', import.meta.url),
  'utf8'
);
const settingsModalCode = await readFile(
  new URL('../src/components/SettingsModal.jsx', import.meta.url),
  'utf8'
);
const settingsCss = await readFile(
  new URL('../src/components/SettingsModal.css', import.meta.url),
  'utf8'
);
const appearanceTabCode = await readFile(
  new URL('../src/components/settings/AppearanceTab.jsx', import.meta.url),
  'utf8'
);
const authScreenCode = await readFile(
  new URL('../src/components/AuthScreen.jsx', import.meta.url),
  'utf8'
);
const indexCss = await readFile(
  new URL('../src/index.css', import.meta.url),
  'utf8'
);

test('preset wallpapers sunset, space, mint and cyber are excluded from selectable presets', () => {
  const wallpaperIds = SETTINGS_WALLPAPERS.map((w) => w.id);
  assert.equal(wallpaperIds.includes('cyber'), false, 'cyber must not be in SETTINGS_WALLPAPERS');
  assert.equal(wallpaperIds.includes('sunset'), false, 'sunset must not be in SETTINGS_WALLPAPERS');
  assert.equal(wallpaperIds.includes('space'), false, 'space must not be in SETTINGS_WALLPAPERS');
  assert.equal(wallpaperIds.includes('mint'), false, 'mint must not be in SETTINGS_WALLPAPERS');
  assert.deepEqual(wallpaperIds, ['classic']);

  const themeIds = SETTINGS_THEMES.map((t) => t.id);
  assert.equal(themeIds.includes('cyber'), false, 'cyber must not be in SETTINGS_THEMES');

  assert.match(settingsModalCode, /deprecatedPresets/);
});

test('rainbow-pearl theme respects custom wallpaper and hides rainbow background overlay', () => {
  assert.match(settingsCss, /html:not\(\.theme-light\)\.theme-rainbow-pearl\s+\.chat-body:not\(\.has-custom-wallpaper\)/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s+\.chat-body:not\(\.has-custom-wallpaper\)/);
  assert.match(settingsCss, /\.chat-body\.has-custom-wallpaper::before[\s\S]*?display:\s*none\s*!important/);
  assert.match(settingsCss, /\.chat-body\.has-custom-wallpaper[\s\S]*?background-size:\s*cover\s*!important/);
});

test('useChatUiState does not strip theme-light for rainbow-pearl or any other theme', () => {
  // Should not contain the old suppression hack: || theme === 'rainbow-pearl'
  assert.doesNotMatch(useChatUiStateCode, /if\s*\(\s*isDarkMode\s*\|\|\s*theme\s*===\s*'rainbow-pearl'\s*\)/);
  assert.doesNotMatch(useChatUiStateCode, /if\s*\(\s*theme\s*===\s*'rainbow-pearl'\s*\)\s*classes\s*=\s*\[\]/);

  // When not dark mode, theme-light class must be applied for every theme
  assert.match(useChatUiStateCode, /document\.documentElement\.classList\.add\('theme-light'\)/);
  assert.match(useChatUiStateCode, /document\.documentElement\.classList\.remove\('theme-light'\)/);
});

test('all themes have full CSS definitions for both dark (night) and light (normal) modes', () => {
  const themes = ['telegram-blue', 'emerald-green', 'sakura-pink', 'electric-purple', 'sunset-amber'];

  // Base accent theme rules
  for (const t of themes) {
    assert.match(settingsCss, new RegExp(`html\\.theme-${t}\\s*\\{`));
    assert.match(settingsCss, new RegExp(`html\\.theme-light\\.theme-${t}\\s*\\{`));
  }

  // Rainbow-pearl has dark mode and light mode rules
  assert.match(settingsCss, /html:not\(\.theme-light\)\.theme-rainbow-pearl\s*\{/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s*\{/);

  // Light mode rainbow pearl styles message bubbles, sidebar, header and inputs
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s+\.message-bubble\.bubble-me/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s+\.message-bubble\.bubble-other/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s+\.sidebar/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s+\.chat-header/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl\s+\.chat-footer-input/);
});

test('all themes have bubble tail SVGs in light mode', () => {
  assert.match(settingsCss, /html\.theme-light\.theme-telegram-blue[\s\S]*?row-me[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(settingsCss, /html\.theme-light\.theme-emerald-green[\s\S]*?row-me[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(settingsCss, /html\.theme-light\.theme-sakura-pink[\s\S]*?row-me[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(settingsCss, /html\.theme-light\.theme-electric-purple[\s\S]*?row-me[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(settingsCss, /html\.theme-light\.theme-sunset-amber[\s\S]*?row-me[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(settingsCss, /html\.theme-light\.theme-rainbow-pearl[\s\S]*?row-me[\s\S]*?background-image:\s*url\("data:image\/svg\+xml/);
});

test('AppearanceTab provides toggle for night mode', () => {
  assert.match(appearanceTabCode, /isDarkMode/);
  assert.match(appearanceTabCode, /setIsDarkMode/);
  assert.match(appearanceTabCode, /Ночной режим/);
});

test('AuthScreen renders required contracts with modern presentation', () => {
  assert.match(authScreenCode, /id=\{isLogin \? 'loginIdentifier' : 'username'\}/);
  assert.match(authScreenCode, /id="password"/);
  assert.match(authScreenCode, /className="auth-logo-img"/);
  assert.match(authScreenCode, /auth-footer-security/);

  // Verify modern styling in index.css
  assert.match(indexCss, /\.auth-screen-container/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-screen-container/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-showcase-panel/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-card/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-tabs/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-tab\.active/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-input-wrapper\s+input/);
});
