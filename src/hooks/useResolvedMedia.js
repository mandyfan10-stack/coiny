import { useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useE2EE } from '../context/E2EEContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { decryptFile } from '../utils/e2eeHelper';
import { getAttachmentMimeType, getPrivateMediaReference } from '../utils/storageMedia';
import { createManagedObjectUrl, revokeManagedObjectUrl } from '../utils/objectUrlRegistry';
import { createMediaCacheContext, isMediaCacheContextCurrent, getCachedMedia, saveCachedMedia } from '../utils/indexedDbHelper';

export default function useResolvedMedia(mediaUrl, chatId, fallbackMimeType, reloadKey = 0) {
  const [media, setMedia] = useState({ source: null, url: null, loading: false, error: null });
  const objectUrlKey = useRef(`resolved-media:${crypto.randomUUID()}`);
  const { sharedKeysCache } = useE2EE();
  const { chats } = useChat();
  const { currentUser } = useAuth() || {};
  const userId = currentUser?.id;
  const chatType = chats.find(chat => chat.id === chatId)?.type;
  const sharedKey = chatType === 'personal' ? sharedKeysCache[chatId] : null;

  useEffect(() => {
    const currentObjectUrlKey = `${objectUrlKey.current}:${crypto.randomUUID()}`;
    const cacheContext = createMediaCacheContext(userId);
    const controller = new AbortController();
    const publish = value => setMedia({ ...value, ownerId: userId });
    if (!mediaUrl) {
      publish({ source: mediaUrl, url: null, loading: false, error: null });
      return;
    }

    const storageReference = getPrivateMediaReference(mediaUrl);
    if (!storageReference || mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:')) {
      publish({ source: mediaUrl, url: mediaUrl, loading: false, error: null });
      return;
    }
    if (!isMediaCacheContextCurrent(cacheContext)) {
      publish({ source: mediaUrl, url: null, loading: false, error: 'Медиа недоступно' });
      return;
    }

    const cacheKey = `media:${storageReference.bucket}:${storageReference.path}`;
    let active = true;
    const isCurrent = () => active && isMediaCacheContextCurrent(cacheContext);
    let objectUrl = null;
    publish({ source: mediaUrl, url: null, loading: true, error: null });

    const load = async () => {
      try {
        // 1. Instant 0ms read from persistent IndexedDB media cache
        const cachedBlob = await getCachedMedia(cacheKey, cacheContext);
        if (!isCurrent()) return;
        if (cachedBlob instanceof Blob) {
          objectUrl = createManagedObjectUrl(currentObjectUrlKey, cachedBlob);
          if (isCurrent()) {
            publish({ source: mediaUrl, url: objectUrl, loading: false, error: null });
          } else {
            revokeManagedObjectUrl(currentObjectUrlKey);
            objectUrl = null;
          }
          return;
        }

        if (!navigator.onLine) {
          throw new Error('Офлайн-режим: медиа отсутствует в локальном кэше');
        }

        // 2. Fetch from remote storage if not cached
        const { data: downloadedBlob, error } = await supabase.storage
          .from(storageReference.bucket)
          .download(storageReference.path, {}, { signal: controller.signal });
        if (error) throw error;
        if (!isCurrent()) return;

        let finalBlob = downloadedBlob;
        if (storageReference.bucket === 'chat-attachments' && downloadedBlob.type.split(';')[0] === 'application/octet-stream') {
          if (!sharedKey) throw new Error('Encryption key is unavailable for this attachment.');
          finalBlob = await decryptFile(
            downloadedBlob,
            sharedKey,
            getAttachmentMimeType(mediaUrl, fallbackMimeType)
          );
        }

        // 3. Save decrypted/ready blob to media-cache for instant offline & future renders
        if (!isCurrent()) return;
        await saveCachedMedia(cacheKey, finalBlob, finalBlob.type, cacheContext);
        if (!isCurrent()) return;

        objectUrl = createManagedObjectUrl(currentObjectUrlKey, finalBlob);
        if (isCurrent()) {
          publish({ source: mediaUrl, url: objectUrl, loading: false, error: null });
        } else {
          revokeManagedObjectUrl(currentObjectUrlKey);
          objectUrl = null;
        }
      } catch (error) {
        if (import.meta.env.DEV) console.warn('Media is unavailable:', error);
        if (isCurrent()) publish({ source: mediaUrl, url: null, loading: false, error: 'Медиа недоступно' });
      }
    };

    load();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) revokeManagedObjectUrl(currentObjectUrlKey);
    };
  }, [mediaUrl, chatId, sharedKey, fallbackMimeType, reloadKey, userId]);

  if (media.source !== mediaUrl || media.ownerId !== userId) return { url: null, loading: Boolean(mediaUrl), error: null };
  return media;
}
