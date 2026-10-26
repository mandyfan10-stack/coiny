const IMAGE_EXTENSIONS = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'svg', 'bmp', 'ico']);
const AUDIO_EXTENSIONS = new Set(['ogg', 'mp3', 'wav', 'm4a', 'aac', 'opus']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'ogv', 'mkv']);

// A display hint, not a URL validator. Blob content is inspected by the viewer.
export function getMediaKindFromUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const source = value.trim();
  const dataKind = source.match(/^data:(image|audio|video)\//i)?.[1];
  if (dataKind) return dataKind.toLowerCase();
  if (/^(blob|data):/i.test(source)) return null;

  try {
    const { pathname } = new URL(source, 'https://coiny.invalid/');
    const filename = decodeURIComponent(pathname).split('/').pop().toLowerCase();
    const extension = filename.match(/\.([a-z0-9]+)$/)?.[1];
    if (IMAGE_EXTENSIONS.has(extension)) return 'image';
    if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
    // Legacy voice recordings share WebM with videos, but use this file prefix.
    if (extension === 'webm' && filename.includes('audio_')) return 'audio';
    if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  } catch {
    // Unknown and malformed references keep the caller's default display type.
  }
  return null;
}
