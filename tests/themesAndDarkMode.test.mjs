import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTINGS_THEMES, SETTINGS_WALLPAPERS } from '../src/components/settings/themesData.ts';

const useChatUiStateCode = await readFile(
  new URL('../src/context/chat/useChatUiState.js', import.meta.url),
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
  new URL('../src/components/AuthScreen.css', import.meta.url),
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
  assert.deepEqual(themeIds, ['telegram-blue', 'emerald-green', 'sakura-pink', 'electric-purple', 'sunset-amber', 'rainbow-pearl']);
  assert.equal(themeIds.includes('cyber'), false, 'cyber must not be in SETTINGS_THEMES');

  assert.match(useChatUiStateCode, /deprecatedPresets/);
});


test('useChatUiState does not strip theme-light for rainbow-pearl or any other theme', () => {
  // Should not contain the old suppression hack: || theme === 'rainbow-pearl'
  assert.doesNotMatch(useChatUiStateCode, /if\s*\(\s*isDarkMode\s*\|\|\s*theme\s*===\s*'rainbow-pearl'\s*\)/);
  assert.doesNotMatch(useChatUiStateCode, /if\s*\(\s*theme\s*===\s*'rainbow-pearl'\s*\)\s*classes\s*=\s*\[\]/);

  // When not dark mode, theme-light class must be applied for every theme
  assert.match(useChatUiStateCode, /document\.documentElement\.classList\.add\('theme-light'\)/);
  assert.match(useChatUiStateCode, /document\.documentElement\.classList\.remove\('theme-light'\)/);
});


test('AppearanceTab provides toggle for night mode', () => {
  assert.match(appearanceTabCode, /isDarkMode/);
  assert.match(appearanceTabCode, /setIsDarkMode/);
  assert.match(appearanceTabCode, /Тёмный режим/);
});

test('AuthScreen renders required contracts with modern presentation', () => {
  assert.match(authScreenCode, /id=\{isLogin \? 'loginIdentifier' : 'username'\}/);
  assert.match(authScreenCode, /id="password"/);
  assert.match(authScreenCode, /className="auth-logo-img"/);
  assert.match(authScreenCode, /auth-footer-security/);

  assert.match(indexCss, /\.auth-screen-container/);
  assert.match(indexCss, /background:\s*var\(--bg-secondary\)/);
  assert.match(indexCss, /color:\s*var\(--text-primary\)/);
  assert.doesNotMatch(indexCss, /gradient|backdrop-filter|glow/);
});
