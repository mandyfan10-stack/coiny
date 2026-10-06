import { TRENDING_GIFS } from '../components/chat/emojiData.js';

// API keys are deployment configuration. A bundled key is public and will be
// abused by anyone who can load the web app; without one the local curated GIF
// catalogue remains available.
const TENOR_API_KEY = String(import.meta.env?.VITE_TENOR_API_KEY || '').trim();
const TENOR_CLIENT_KEY = 'tenor_web';
const BASE_URL = 'https://tenor.googleapis.com/v2';

export const TENOR_CATEGORIES = [
  { id: 'trending', label: '🔥 Тренды', query: '' },
  { id: 'reactions', label: '😂 Реакции', query: 'reactions' },
  { id: 'memes', label: '🐸 Мемы', query: 'memes' },
  { id: 'cats', label: '🐱 Котики', query: 'cats' },
  { id: 'anime', label: '✨ Аниме', query: 'anime' },
  { id: 'love', label: '❤️ Любовь', query: 'love' },
  { id: 'dance', label: '💃 Танцы', query: 'dance' },
  { id: 'sad', label: '🥺 Грусть', query: 'sad' }
];

function normalizeTenorItem(item) {
  const formats = item.media_formats || {};
  const gifUrl = formats.gif?.url || formats.mediumgif?.url || formats.tinygif?.url || item.url;
  const previewUrl = formats.tinygif?.url || formats.nanogif?.url || gifUrl;
  const dims = formats.tinygif?.dims || formats.gif?.dims || [180, 120];

  return {
    id: item.id || `gif-${Math.random()}`,
    title: item.content_description || item.title || 'GIF',
    url: gifUrl,
    preview: previewUrl,
    width: dims[0],
    height: dims[1]
  };
}

/**
 * Filter curated GIFs with tokenized multilingual search and pagination
 */
function searchLocalGifs(query = '', category = '', pos = null, limit = 20) {
  const clean = String(query || '').trim().toLowerCase();
  const cat = String(category || '').trim().toLowerCase();
  const offset = pos ? parseInt(pos, 10) || 0 : 0;

  let pool = TRENDING_GIFS;

  if (cat && cat !== 'trending') {
    const catFiltered = pool.filter((g) => g.category === cat || g.tags?.includes(cat));
    if (catFiltered.length > 0) {
      pool = catFiltered;
    }
  }

  if (clean && clean !== cat) {
    const tokens = clean.split(/\s+/).filter(Boolean);
    pool = pool.filter((gif) => {
      const title = (gif.title || '').toLowerCase();
      const tags = (gif.tags || []).map((t) => t.toLowerCase());
      const gCat = (gif.category || '').toLowerCase();

      return tokens.every((token) => {
        if (title.includes(token) || gCat.includes(token)) return true;
        return tags.some((tag) => tag.includes(token) || token.includes(tag));
      });
    });
  }

  const paged = pool.slice(offset, offset + limit);
  const nextPos = offset + limit < pool.length ? String(offset + limit) : null;

  return {
    results: paged.map((g) => ({
      id: g.id,
      title: g.title,
      url: g.url,
      preview: g.preview || g.url,
      width: g.width || 180,
      height: g.height || 120
    })),
    nextPos
  };
}

async function fetchTenor(path, params) {
  if (!TENOR_API_KEY) return null;

  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set('key', TENOR_API_KEY);
  url.searchParams.set('client_key', TENOR_CLIENT_KEY);
  url.searchParams.set('media_filter', 'gif,tinygif,nanogif');
  url.searchParams.set('contentfilter', 'medium');
  for (const [name, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(name, String(value));
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Tenor API responded with status ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch featured/trending GIFs from Tenor or local curated database
 */
export async function fetchTrendingTenorGifs(pos = null, limit = 20) {
  if (TENOR_API_KEY) {
    try {
      const data = await fetchTenor('featured', { limit, pos });
      if (data && data.results && data.results.length > 0) {
        return {
          results: data.results.map(normalizeTenorItem),
          nextPos: data.next || null
        };
      }
    } catch (err) {
      console.warn('Tenor API offline/failed, using fallback curated GIFs:', err);
    }
  }
  return searchLocalGifs('', 'trending', pos, limit);
}

/**
 * Search GIFs using Tenor API or local curated database
 */
export async function searchTenorGifs(query, pos = null, limit = 20, category = '') {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery && !category) {
    return fetchTrendingTenorGifs(pos, limit);
  }

  if (TENOR_API_KEY) {
    try {
      const searchTarget = cleanQuery || category || '';
      const data = await fetchTenor('search', { q: searchTarget, limit, pos });
      if (data && data.results && data.results.length > 0) {
        return {
          results: (data.results || []).map(normalizeTenorItem),
          nextPos: data.next || null
        };
      }
    } catch (err) {
      console.warn('Tenor Search API error, searching local fallback GIFs:', err);
    }
  }

  return searchLocalGifs(cleanQuery, category || cleanQuery, pos, limit);
}
