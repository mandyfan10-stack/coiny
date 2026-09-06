import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  fetchTrendingTenorGifs,
  searchTenorGifs,
  TENOR_CATEGORIES
} from '../src/services/tenorService.js';
import { TRENDING_GIFS, searchGifs } from '../src/components/chat/emojiData.js';

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
const chatAreaCode = await readFile(
  new URL('../src/components/ChatArea.jsx', import.meta.url),
  'utf8'
);
const appearanceTabCode = await readFile(
  new URL('../src/components/settings/AppearanceTab.jsx', import.meta.url),
  'utf8'
);
const settingsCss = await readFile(
  new URL('../src/components/SettingsModal.css', import.meta.url),
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

test('SettingsModal detects custom wallpaper accurately and synchronizes with classic default', () => {
  assert.match(settingsModalCode, /const\s+activeWp\s*=\s*wallpaper\s*\|\|\s*currentUser\.wallpaper;/);
  assert.match(settingsModalCode, /setCustomWallpaperUrl/);
  assert.match(settingsModalCode, /setWallpaper\('classic'\)/);
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

  assert.match(themesData, /id: 'classic'[\s\S]*?#0b141a/);
  assert.doesNotMatch(themesData, /id: 'sunset'/);
  assert.doesNotMatch(themesData, /id: 'space'/);
  assert.doesNotMatch(themesData, /id: 'mint'/);
  assert.doesNotMatch(themesData, /id: 'cyber'/);

  assert.match(chatAreaCss, /\[data-wallpaper="classic"\][\s\S]*?#0b141a/);
});

test('Tenor GIF service does not hardcode Google API keys', () => {
  assert.doesNotMatch(tenorServiceCode, /AIza/);
  assert.match(tenorServiceCode, /VITE_TENOR_API_KEY/);
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
  assert.match(chatAreaCode, /isCustomWallpaper\s*=\s*Boolean\(wallpaper\s*&&\s*wallpaper\s*!==\s*'classic'\s*&&\s*wallpaper\s*!==\s*'default'\)/);
  assert.match(chatAreaCode, /className=\{`chat-body\s*\$\{isCustomWallpaper\s*\?\s*'has-custom-wallpaper'\s*:\s*''\}`\}/);

  assert.match(settingsCss, /\.chat-body\.has-custom-wallpaper[\s\S]*?background-size:\s*cover\s*!important/);
  assert.match(settingsCss, /\.chat-body\.has-custom-wallpaper::before[\s\S]*?display:\s*none\s*!important/);
  assert.match(settingsCss, /html:not\(\.theme-light\)\.theme-rainbow-pearl\s+\.chat-body:not\(\.has-custom-wallpaper\)/);

  assert.doesNotMatch(appearanceTabCode, /wallpapers-grid/);
  assert.match(appearanceTabCode, /Поддерживаемые\s*форматы:\s*PNG,\s*JPG,\s*WebP/);
  assert.match(appearanceTabCode, /wallpaper-custom-card/);
  assert.match(appearanceTabCode, /wallpaper-default-card/);
});

test('SettingsModal isolates profile form reset from wallpaper changes and clears file input', () => {
  // Profile input initialization does NOT depend on wallpaper or setWallpaper
  assert.match(settingsModalCode, /useEffect\(\(\)\s*=>\s*\{[\s\S]*?setName\(currentUser\.name\s*\|\|\s*''\);[\s\S]*?\}\s*,\s*\[currentUser,\s*isSettingsOpen\]\);/);

  // Wallpaper upload clears e.target.value in finally block
  assert.match(settingsModalCode, /handleWallpaperUpload[\s\S]*?finally\s*\{[\s\S]*?if\s*\(e\.target\)\s*e\.target\.value\s*=\s*'';/);
});

test('ChatArea does not bind wallpaper resolution to activeChat.id and safely resolves direct URLs', () => {
  // useResolvedMedia for wallpaper passes null chatId to avoid re-downloads and flicker on chat switch
  assert.match(chatAreaCode, /useResolvedMedia\(\s*isCustomWallpaper\s*\?\s*wallpaper\s*:\s*null,\s*null,\s*'image\/webp'\s*\)/);
  assert.match(chatAreaCode, /isDirectWallpaper/);
  assert.match(chatAreaCode, /url\("\$\{activeWallpaperUrl\}"\)/);
});

test('AppearanceTab guards preview image against raw storage references and clears input on delete', () => {
  assert.match(appearanceTabCode, /isDirectUrl/);
  assert.match(appearanceTabCode, /displayPreview\s*=\s*resolvedPreviewUrl\s*\|\|\s*\(isDirectUrl\s*\?\s*effectiveCustomUrl\s*:\s*null\)/);
  assert.match(appearanceTabCode, /wallpaperInputRef\.current\.value\s*=\s*''/);
});

