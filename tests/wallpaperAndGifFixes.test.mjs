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

test('SettingsModal detects custom wallpaper accurately for all presets', () => {
  assert.match(settingsModalCode, /'classic',\s*'sunset',\s*'space',\s*'mint'/);
  assert.match(settingsModalCode, /const\s+activeWp\s*=\s*wallpaper\s*\|\|\s*currentUser\.wallpaper;/);
});

test('settings wallpaper previews match the actual chat-body wallpaper CSS and cyber is excluded', async () => {
  const themesData = await readFile(
    new URL('../src/components/settings/themesData.ts', import.meta.url),
    'utf8'
  );
  const chatAreaCss = await readFile(
    new URL('../src/components/ChatArea.css', import.meta.url),
    'utf8'
  );

  assert.match(themesData, /id: 'classic'[\s\S]*?#0b141a/);
  assert.match(themesData, /id: 'sunset'[\s\S]*?#302b63/);
  assert.match(themesData, /id: 'space'[\s\S]*?#1b2735/);
  assert.match(themesData, /id: 'mint'[\s\S]*?#11221b/);
  assert.doesNotMatch(themesData, /id: 'cyber'/);

  assert.match(chatAreaCss, /\[data-wallpaper="classic"\][\s\S]*?#0b141a/);
  assert.match(chatAreaCss, /\[data-wallpaper="sunset"\][\s\S]*?#302b63/);
  assert.match(chatAreaCss, /\[data-wallpaper="space"\][\s\S]*?#1b2735/);
  assert.match(chatAreaCss, /\[data-wallpaper="mint"\][\s\S]*?#11221b/);
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
