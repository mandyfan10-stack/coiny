import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/SettingsModal.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/components/SettingsModal.css', import.meta.url), 'utf8');

test('settings modal keeps its lazy boundary mounted through the exit transition', () => {
  assert.match(app, /const SETTINGS_EXIT_DURATION_MS = 260/);
  assert.match(app, /const \[shouldRender, setShouldRender\] = useState\(isSettingsOpen\)/);
  assert.match(app, /setTimeout\([\s\S]*setShouldRender\(false\)[\s\S]*SETTINGS_EXIT_DURATION_MS/);
  assert.match(app, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(app, /returnFocusRef/);
});

test('settings modal enters after mount and provides complete dialog focus behavior', () => {
  assert.match(modal, /requestAnimationFrame\([\s\S]*requestAnimationFrame\([\s\S]*setIsVisible\(true\)/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="settings-dialog-title"/);
  assert.match(modal, /aria-label="Закрыть настройки"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test('settings modal no longer opens a custom profile styling dialog', () => {
  assert.doesNotMatch(modal, /settingsTab === 'cosmetics'/);
  assert.doesNotMatch(modal, /cosmetics-dialog/);
  assert.doesNotMatch(modal, /Закрыть оформление профиля/);
  assert.doesNotMatch(styles, /\.cosmetics-dialog/);
});

test('settings motion is subtle, non-interactive while hidden, and reduced-motion safe', () => {
  assert.match(styles, /pointer-events: none/);
  assert.match(styles, /transform:\s*none/);
  assert.doesNotMatch(styles, /translateY\(12px\) scale\(0\.98\)/);
  assert.match(styles, /opacity 180ms ease/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});
