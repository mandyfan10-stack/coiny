// @ts-check
import { supabase } from '../supabaseClient.js';

const IMAGE_MIME_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);
const LIMITS = {
  avatar: 5 * 1024 * 1024,
  story: 10 * 1024 * 1024,
  wallpaper: 10 * 1024 * 1024,
  banner: 10 * 1024 * 1024,
  'group-avatar': 5 * 1024 * 1024,
};

/** @typedef {'avatar' | 'story' | 'wallpaper' | 'banner' | 'group-avatar'} PublicImageKind */

/**
 * Upload a public image through the sanitizing Edge Function (re-encodes and
 * strips metadata server-side).
 * @param {Blob} file
 * @param {string} kind one of {@link PublicImageKind}; others are rejected
 * @param {{ chatId?: string }} [options]
 * @returns {Promise<{ reference: string, path: string }>}
 */
export async function uploadSanitizedPublicImage(file, kind, { chatId } = {}) {
  if (!(file instanceof Blob) || !IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error('Поддерживаются только JPEG, PNG, WebP и AVIF изображения.');
  }
  const limit = Object.hasOwn(LIMITS, kind) ? LIMITS[/** @type {PublicImageKind} */ (kind)] : 0;
  if (!limit || file.size < 1 || file.size > limit) {
    throw new Error('Размер изображения превышает допустимый лимит.');
  }
  if (!supabase) throw new Error('Supabase не настроен.');

  const body = new FormData();
  body.append('file', file);
  body.append('kind', kind);
  if (chatId) body.append('chatId', chatId);

  const { data, error } = await supabase.functions.invoke('sanitize-public-image', { body });
  if (error) {
    let detail = error.message || 'Edge Function returned a non-2xx status code';
    try {
      const response = error.context;
      if (response && typeof response.json === 'function') {
        const payload = await response.json();
        if (payload?.error) detail = String(payload.error);
      }
    } catch {
      /* keep the gateway message */
    }
    throw new Error(detail);
  }
  if (!data?.reference || !data?.path) throw new Error('Сервер вернул некорректный путь изображения.');
  return data;
}
