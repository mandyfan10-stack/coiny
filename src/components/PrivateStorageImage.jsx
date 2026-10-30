import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { getPrivateMediaReference } from '../utils/storageMedia';
import { useAuth } from '../context/AuthContext';
import { createManagedObjectUrl, revokeManagedObjectUrl } from '../utils/objectUrlRegistry';
import { createMediaCacheContext, isMediaCacheContextCurrent, getCachedMedia, saveCachedMedia } from '../utils/indexedDbHelper';

async function loadPrivateImage(url, objectUrlKey, cacheContext, signal, isCurrent) {
  const storageReference = getPrivateMediaReference(url);
  const cacheKey = `storage:${storageReference.bucket}:${storageReference.path}`;

  try {
    const cachedBlob = await getCachedMedia(cacheKey, cacheContext);
    if (!isCurrent()) return null;
    if (cachedBlob instanceof Blob) {
      return createManagedObjectUrl(objectUrlKey, cachedBlob);
    }
  } catch {
    // Fall through to network
  }

  const { data, error } = await supabase.storage
    .from(storageReference.bucket)
    .download(storageReference.path, {}, { signal });

  if (error) throw error;
  if (!isCurrent()) return null;

  await saveCachedMedia(cacheKey, data, data.type, cacheContext);
  if (!isCurrent()) return null;

  return createManagedObjectUrl(objectUrlKey, data);
}

export default function PrivateStorageImage({ src, alt, fallback = '👤', ...props }) {
  const { currentUser } = useAuth() || {};
  const userId = currentUser?.id;
  const [image, setImage] = useState({ source: null, url: null, error: false });
  const objectUrlKey = useRef(`private-image:${crypto.randomUUID()}`);

  useEffect(() => {
    let active = true;
    let objectUrl = null;
    const cacheContext = createMediaCacheContext(userId);
    const controller = new AbortController();
    const isCurrent = () => active && isMediaCacheContextCurrent(cacheContext);
    const publish = value => setImage({ ...value, ownerId: userId });
    const currentObjectUrlKey = `${objectUrlKey.current}:${crypto.randomUUID()}`;

    if (!src) {
      publish({ source: src, url: null, error: true });
      return;
    }

    if (!getPrivateMediaReference(src)) {
      publish({ source: src, url: src, error: false });
      return;
    }
    if (!isCurrent()) {
      publish({ source: src, url: null, error: true });
      return;
    }

    publish({ source: src, url: null, error: false });

    loadPrivateImage(src, currentObjectUrlKey, cacheContext, controller.signal, isCurrent)
      .then(url => {
        objectUrl = url;
        if (isCurrent()) publish({ source: src, url, error: false });
        else revokeManagedObjectUrl(currentObjectUrlKey);
      })
      .catch(error => {
        if (import.meta.env.DEV) console.warn('Avatar is unavailable:', error);
        if (isCurrent()) publish({ source: src, url: null, error: true });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) revokeManagedObjectUrl(currentObjectUrlKey);
    };
  }, [src, userId]);

  if (image.source !== src || image.ownerId !== userId || (!image.url && !image.error)) return null;
  if (image.error) {
    if (typeof fallback === 'string' || typeof fallback === 'number') {
      return <span className="avatar-text">{fallback}</span>;
    }
    return fallback ?? null;
  }

  return (
    <img
      src={image.url}
      alt={alt}
      {...props}
      onError={() => setImage({ source: src, url: null, error: true, ownerId: userId })}
    />
  );
}
