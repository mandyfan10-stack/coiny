import { supabase } from '../supabaseClient';
import { createMediaCacheContext, getCachedMedia } from '../utils/indexedDbHelper';
import { getPrivateMediaReference, getAttachmentMimeType } from '../utils/storageMedia';
import { createStorageReference } from '../utils/urlSecurity';
import { requiresPersonalE2EE } from '../utils/savedMessages';
import { decryptFile, encryptFileForE2EE, requireE2EEKey } from '../utils/e2eeHelper';
import { resolveSharedKey } from '../context/chat/decryptHelpers';
import { extensionForMedia, validateChatMedia } from '../utils/mediaValidation';
import { dataService } from './dataLayer';

export async function prepareForwardMedia(message, source, target, userId, messageId, keys) {
  const cacheContext = createMediaCacheContext(userId);
  if (!message.media) return null;
  const reference = getPrivateMediaReference(message.media);
  // Public sticker/GIF URLs have no source-chat permissions or encryption keys.
  if (!reference && /^https?:/.test(message.media)) return message.media;
  if (!dataService.isLive()) return message.media;
  const fallback = /^(🎤|Голосовое)/.test(message.text || '') ? 'audio/webm'
    : /^(🎬|Видео)/.test(message.text || '') ? 'video/webm' : 'image/webp';
  let blob;
  if (reference) {
    blob = await getCachedMedia(`media:${reference.bucket}:${reference.path}`, cacheContext);
    keys.guard();
    if (!blob) {
      const { data, error } = await supabase.storage.from(reference.bucket).download(reference.path);
      if (error) throw new Error('Не удалось загрузить исходное вложение.');
      blob = data;
      if (reference.bucket === 'chat-attachments' && blob.type.split(';')[0] === 'application/octet-stream') {
        const key = await resolveSharedKey({ ...keys, chatId: source.id, chat: source, currentUserId: userId });
        requireE2EEKey(key);
        blob = await decryptFile(blob, key, getAttachmentMimeType(message.media, fallback));
      }
    }
  } else {
    if (!/^(blob:|data:)/.test(message.media)) throw new Error('Вложение недоступно для пересылки.');
    const response = await fetch(message.media);
    if (!response.ok) throw new Error('Вложение недоступно.');
    blob = await response.blob();
  }
  keys.guard();
  const info = validateChatMedia(blob);
  const path = `${target.id}/${userId}/forward_${messageId}.${extensionForMedia(info.mimeType, info.kind)}`;
  let payload = blob;
  if (requiresPersonalE2EE(target, userId)) {
    const key = await resolveSharedKey({ ...keys, chatId: target.id, chat: target, currentUserId: userId });
    requireE2EEKey(key);
    payload = await encryptFileForE2EE(blob, key);
  }
  keys.guard();
  const { error } = await supabase.storage.from('chat-attachments').upload(path, payload, {
    contentType: requiresPersonalE2EE(target, userId) ? 'application/octet-stream' : info.mimeType
  });
  if (error) throw new Error('Не удалось загрузить вложение в выбранный чат.');
  return createStorageReference('chat-attachments', path);
}
