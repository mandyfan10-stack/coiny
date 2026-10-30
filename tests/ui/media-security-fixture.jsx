import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatContext } from '../../src/context/ChatContext';
import PrivateStorageImage from '../../src/components/PrivateStorageImage';
import StickerMessage from '../../src/components/StickerMessage';
import useResolvedMedia from '../../src/hooks/useResolvedMedia';
import { supabase } from '../../src/supabaseClient';
import * as cache from '../../src/utils/indexedDbHelper';
import { encryptFile } from '../../src/utils/e2eeHelper';
import { prepareForwardMedia } from '../../src/services/forwardMedia';
import { dataService } from '../../src/services/dataLayer';

const control = { requests: [], cache };
window.__mediaSecurity = control;
const imageMode = new URLSearchParams(location.search).has('image');
const stickerMode = new URLSearchParams(location.search).has('sticker');
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const imageBlob = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))], { type: 'image/png' });
const privateBlob = await encryptFile(imageBlob, key);
const reference = imageMode ? 'storage://avatars/owner-a/avatar.webp' : 'storage://chat-attachments/private/owner-a/msg.webp';
control.reference = reference;
supabase.storage.from = bucket => ({
  download(path, _options, parameters) {
    return new Promise(resolve => control.requests.push({ bucket, path, signal: parameters?.signal, resolve }));
  },
  upload: async () => ({ error: null })
});
// Deliberately ignore abort at the fake network boundary: consumers must reject
// stale results even when a custom transport resolves after cancellation.
control.complete = (index, error = false) => control.requests[index].resolve(error
  ? { data: null, error: new Error('Access denied') }
  : { data: imageMode ? imageBlob : privateBlob, error: null });
control.stats = cache.getCacheStorageStats;
control.forward = userId => {
  dataService.isLive = () => true;
  return prepareForwardMedia({ media: reference }, { id: 'private' }, { id: 'destination', type: 'group' }, userId,
    'forward-id', { guard() {}, sharedKeysCache: {} });
};
function Media() {
  const media = useResolvedMedia(reference, 'private', 'image/webp');
  control.media = media;
  return <p data-testid="media">{media.url || media.error || 'pending'}</p>;
}
function Harness() {
  const [userId, setUserId] = useState('owner-a');
  const [sticker, setSticker] = useState('/fixture-dangerous.json');
  control.setUser = setUserId;
  control.setSticker = setSticker;
  control.logout = async () => { setUserId(null); await cache.clearOfflineDatabase(); };
  return <AuthContext.Provider value={{ currentUser: userId ? { id: userId } : null }}>
    <E2EEContext.Provider value={{ sharedKeysCache: userId === 'owner-a' ? { private: key } : {} }}>
      <ChatContext.Provider value={{ chats: [{ id: 'private', type: 'personal' }] }}>
        <p data-testid="owner">{userId || 'signed-out'}</p>
        {stickerMode ? <StickerMessage mediaUrl={sticker}/> : userId && (imageMode ? <PrivateStorageImage src={reference} alt="private"/> : <Media/>)}
      </ChatContext.Provider>
    </E2EEContext.Provider>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
