import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  fetchTrendingTenorGifs,
  searchTenorGifs,
  TENOR_CATEGORIES
} from '../src/services/tenorService.js';
import { TRENDING_GIFS, searchGifs } from '../src/components/chat/emojiData.js';
import { getChatBodyStyle, isCustomWallpaper } from '../src/components/chat/chatAreaModel.ts';

const useChatUiStateCode = await readFile(
  new URL('../src/context/chat/useChatUiState.js', import.meta.url),
  'utf8'
);
const chatProviderCode = await readFile(
  new URL('../src/context/chat/ChatProvider.jsx', import.meta.url),
  'utf8'
);
const settingsModalCode = await readFile(
  new URL('../src/components/SettingsModal.jsx', import.meta.url),
  'utf8'
);
const tenorServiceCode = await readFile(
  new URL('../src/services/tenorService.js', import.meta.url),
  'utf8'
);
const appearanceTabCode = await readFile(
  new URL('../src/components/settings/AppearanceTab.jsx', import.meta.url),
  'utf8'
);
const chatAreaCss = await readFile(
  new URL('../src/components/ChatArea.css', import.meta.url),
  'utf8'
);

test('useChatUiState initializes wallpaper and theme from localStorage', () => {
  assert.match(useChatUiStateCode, /localStorage\.getItem\('coingram-wallpaper'\)/);
  assert.match(useChatUiStateCode, /localStorage\.getItem\('coingram-theme'\)/);
});

test('useChatUiState synchronizes wallpaper and theme when currentUser loads', () => {
  assert.match(useChatUiStateCode, /currentUser\?\.wallpaper/);
  assert.match(useChatUiStateCode, /currentUser\?\.theme/);
  assert.match(useChatUiStateCode, /setWallpaper\(currentUser\.wallpaper\)/);
  assert.match(useChatUiStateCode, /setTheme\(currentUser\.theme\)/);
  assert.match(useChatUiStateCode, /localStorage\.setItem\('coingram-wallpaper',\s*wallpaper\)/);
});

test('ChatProvider passes currentUser to useChatUiState', () => {
  assert.match(chatProviderCode, /const\s+ui\s*=\s*useChatUiState\(currentUser\);/);
});

test('AppearanceTab detects custom wallpaper while UI state normalizes legacy defaults', () => {
  assert.match(appearanceTabCode, /const effectiveCustomUrl = wallpaper/);
  assert.match(appearanceTabCode, /const hasCustomWallpaper = Boolean\(effectiveCustomUrl\)/);
  assert.match(useChatUiStateCode, /setWallpaper\('classic'\)/);
});

test('settings wallpapers only has classic and preset wallpapers are removed', async () => {
  const themesData = await readFile(
    new URL('../src/components/settings/themesData.ts', import.meta.url),
    'utf8'
  );
  const chatAreaCss = await readFile(
    new URL('../src/components/ChatArea.css', import.meta.url),
    'utf8'
  );

  assert.match(themesData, /id: 'classic'[\s\S]*?var\(--chat-wallpaper\)/);
  assert.doesNotMatch(themesData, /id: 'sunset'/);
  assert.doesNotMatch(themesData, /id: 'space'/);
  assert.doesNotMatch(themesData, /id: 'mint'/);
  assert.doesNotMatch(themesData, /id: 'cyber'/);

  assert.match(chatAreaCss, /\[data-wallpaper="classic"\][\s\S]*?var\(--chat-wallpaper\)/);
});

test('Tenor GIF service does not hardcode Google API keys', () => {
  assert.doesNotMatch(tenorServiceCode, /AIza/);
  assert.match(tenorServiceCode, /VITE_TENOR_API_KEY/);
});

test('all release builds receive the configured Tenor key', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(workflow, /env:[\s\S]*?VITE_TENOR_API_KEY: \$\{\{ secrets\.VITE_TENOR_API_KEY \}\}[\s\S]*?jobs:/);
  assert.match(example, /^VITE_TENOR_API_KEY=/m);
  assert.match(workflow, /test -n "\$VITE_TENOR_API_KEY"/);
});

test('Tenor categories contain 8 valid category definitions', () => {
  assert.equal(TENOR_CATEGORIES.length, 8);
  const ids = TENOR_CATEGORIES.map((c) => c.id);
  assert.deepEqual(ids, ['trending', 'reactions', 'memes', 'cats', 'anime', 'love', 'dance', 'sad']);
});

test('fetchTrendingTenorGifs returns non-empty results with proper schema', async () => {
  const data = await fetchTrendingTenorGifs(null, 10);
  assert.ok(data.results.length > 0);
  const first = data.results[0];
  assert.ok(first.id);
  assert.ok(first.title);
  assert.ok(first.url);
  assert.ok(first.preview);
});

test('searchTenorGifs returns results for all 8 categories', async () => {
  for (const cat of TENOR_CATEGORIES) {
    const res = await searchTenorGifs(cat.query, null, 10, cat.id);
    assert.ok(res.results.length > 0, `Category ${cat.id} must return GIF results`);
  }
});

test('searchTenorGifs returns results for Russian and English queries', async () => {
  const queries = ['кот', 'cat', 'смех', 'мем', 'аниме', 'любовь', 'dance', 'sad', 'пепе', 'fire'];
  for (const q of queries) {
    const res = await searchTenorGifs(q, null, 10);
    assert.ok(res.results.length > 0, `Query "${q}" must return GIF results`);
  }
});

test('searchGifs helper handles Russian and English keyword matches', () => {
  const catMatches = searchGifs('котик');
  assert.ok(catMatches.length > 0);
  const memeMatches = searchGifs('мем');
  assert.ok(memeMatches.length > 0);
  const animeMatches = searchGifs('anime');
  assert.ok(animeMatches.length > 0);
});

test('TRENDING_GIFS contains 50+ items across diverse categories', () => {
  assert.ok(TRENDING_GIFS.length >= 50);
});

test('custom wallpaper is correctly applied and prioritized over themes', () => {
  assert.equal(isCustomWallpaper('classic'), false);
  assert.equal(isCustomWallpaper('default'), false);
  assert.equal(isCustomWallpaper('https://cdn.test/wall.webp'), true);
  assert.equal(getChatBodyStyle('https://cdn.test/wall.webp', null).backgroundSize, 'cover');

  assert.match(chatAreaCss, /\.chat-body\.has-custom-wallpaper[\s\S]*?background-size:\s*cover\s*!important/);
  assert.match(chatAreaCss, /\.chat-body\.has-custom-wallpaper::before[\s\S]*?display:\s*none\s*!important/);

  assert.doesNotMatch(appearanceTabCode, /wallpapers-grid/);
  assert.match(appearanceTabCode, /PNG,\s*JPG,\s*WebP/);
  assert.match(appearanceTabCode, /settings-wallpaper-preview/);
  assert.match(appearanceTabCode, /displayPreview/);
});

test('SettingsModal initializes drafts once per opening and clears uploaded file input', () => {
  assert.match(settingsModalCode, /if \(!currentUser \|\| initializedRef\.current\) return/);
  assert.match(settingsModalCode, /initializedRef\.current = true/);
  assert.match(settingsModalCode, /setName\(saved\.name\)/);
  assert.match(settingsModalCode, /finally \{ finishRequest\(field\); input\.value = '';/);
});

test('wallpaper storage references are painted only once resolved; direct URLs paint immediately', () => {
  const reference = 'storage://public-media/user/wall.webp';
  assert.equal(getChatBodyStyle(reference, null).backgroundImage, 'none');
  assert.equal(getChatBodyStyle(reference, 'blob:resolved').backgroundImage, 'url("blob:resolved")');
  assert.equal(getChatBodyStyle('data:image/png;base64,AA', null).backgroundImage, 'url("data:image/png;base64,AA")');
});

test('AppearanceTab guards preview image against raw storage references and clears input on delete', () => {
  assert.match(appearanceTabCode, /isDirectUrl/);
  assert.match(appearanceTabCode, /displayPreview\s*=\s*resolvedPreviewUrl\s*\|\|\s*\(isDirectUrl\s*\?\s*effectiveCustomUrl\s*:\s*null\)/);
  assert.match(appearanceTabCode, /wallpaperInputRef\.current\.value\s*=\s*''/);
});
