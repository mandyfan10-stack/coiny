import { supabaseProjectUrl } from '../supabaseClient.js';
import { getStorageObjectPath, getStorageReference } from './urlSecurity.js';
export { getAttachmentMimeType } from './mediaValidation.ts';

const PRIVATE_MEDIA_BUCKETS = ['chat-attachments', 'avatars', 'stories', 'wallpapers', 'banners', 'group-avatars'];

export function getPrivateAttachmentPath(url) {
  return getStorageObjectPath(url, 'chat-attachments', supabaseProjectUrl);
}

export function getPrivateMediaReference(url) {
  return getStorageReference(url, PRIVATE_MEDIA_BUCKETS, supabaseProjectUrl);
}
