export const MAX_CHAT_MEDIA_BYTES = 15 * 1024 * 1024;

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaTypeInfo {
  kind: MediaKind;
  extension: string;
}

export interface ValidatedChatMedia extends MediaTypeInfo {
  mimeType: string;
}

const MEDIA_TYPES = new Map<string, MediaTypeInfo>([
  ['image/avif', { kind: 'image', extension: 'avif' }],
  ['image/gif', { kind: 'image', extension: 'gif' }],
  ['image/jpeg', { kind: 'image', extension: 'jpg' }],
  ['image/png', { kind: 'image', extension: 'png' }],
  ['image/webp', { kind: 'image', extension: 'webp' }],
  ['video/mp4', { kind: 'video', extension: 'mp4' }],
  ['video/ogg', { kind: 'video', extension: 'ogv' }],
  ['video/webm', { kind: 'video', extension: 'webm' }],
  ['audio/aac', { kind: 'audio', extension: 'aac' }],
  ['audio/flac', { kind: 'audio', extension: 'flac' }],
  ['audio/mp4', { kind: 'audio', extension: 'm4a' }],
  ['audio/mpeg', { kind: 'audio', extension: 'mp3' }],
  ['audio/ogg', { kind: 'audio', extension: 'ogg' }],
  ['audio/wav', { kind: 'audio', extension: 'wav' }],
  ['audio/webm', { kind: 'audio', extension: 'webm' }],
  ['audio/x-m4a', { kind: 'audio', extension: 'm4a' }]
]);

export const CHAT_MEDIA_ACCEPT = [...MEDIA_TYPES.keys()].join(',');

export function getAttachmentMimeType(mediaUrl?: string, fallbackMimeType?: string): string {
  const extension = mediaUrl?.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  if (extension === 'mp4') return fallbackMimeType?.startsWith('audio/') ? 'audio/mp4' : 'video/mp4';
  if (extension === 'ogg') return fallbackMimeType?.startsWith('video/') ? 'video/ogg' : 'audio/ogg';
  if (extension === 'webm') return fallbackMimeType || 'video/webm';
  if (extension === 'jpeg') return 'image/jpeg';
  for (const [mime, info] of MEDIA_TYPES) if (info.extension === extension) return mime;
  return fallbackMimeType || 'application/octet-stream';
}

export function validateChatMedia(file: Pick<File, 'size' | 'type'> | null | undefined): ValidatedChatMedia {
  if (!file || file.size <= 0) throw new Error('Файл пуст.');
  if (file.size > MAX_CHAT_MEDIA_BYTES) throw new Error('Размер файла превышает лимит 15 МБ.');

  const type = String(file.type || '').toLowerCase().split(';')[0].trim();
  const media = MEDIA_TYPES.get(type);
  if (!media) throw new Error('Этот формат файла не поддерживается.');

  return { ...media, mimeType: type };
}

export function extensionForMedia(mimeType: string | null | undefined, fallbackKind: MediaKind | string = 'image'): string {
  const normalizedType = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return MEDIA_TYPES.get(normalizedType)?.extension
    || (fallbackKind === 'video' ? 'webm' : fallbackKind === 'audio' ? 'webm' : 'png');
}
