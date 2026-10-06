import {
  isNetworkError,
  createOfflineQueueItem
} from './offlineQueueCore.js';
import {
  loadEncryptedOfflineQueue,
  saveEncryptedOfflineQueue
} from '../utils/indexedDbHelper.js';
import { requiresPersonalE2EE } from '../utils/savedMessages.ts';
import { extensionForMedia as defaultExtensionForMedia } from '../utils/mediaValidation.ts';

export {
  isNetworkError,
  createOfflineQueueItem
};

export const loadOfflineQueue = loadEncryptedOfflineQueue;
export const saveOfflineQueue = saveEncryptedOfflineQueue;

function isAlreadyUploaded(error) {
  return Number(error?.statusCode ?? error?.status) === 409;
}

function isDuplicateMessageId(error) {
  return error?.code === '23505';
}

/**
 * Upload offline media (if any), optionally E2EE-encrypt, and send the message.
 *
 * Optional injects on `deps` (for unit tests):
 * `sendMessage`, `getAttachment`, `deleteAttachment`, `storage`,
 * `importPublicKey`, `deriveSymmetricKey`, `encryptMessage`, `encryptFileForE2EE`, `requireE2EEKey`,
 * `extensionForMedia`
 *
 * @param {object} item - offline queue entry
 * @param {object} deps
 * @returns {Promise<{ data: object, finalMediaUrl: string|null }>}
 */
export async function processOfflineQueueItem(item, deps) {
  const {
    chat,
    currentUser,
    e2eePrivateKey,
    sharedKey: initialSharedKey,
    onSharedKey
  } = deps;

  let finalMediaUrl = item.media ?? null;
  const requiresE2EE = requiresPersonalE2EE(chat, currentUser.id);
  const otherMember = requiresE2EE
    ? chat.members?.find((m) => m.id !== currentUser.id)
    : null;
  let sharedKey = requiresE2EE ? initialSharedKey : null;

  const e2ee = requiresE2EE
    ? {
        importPublicKey: deps.importPublicKey
          ?? (await import('../utils/e2eeHelper.js')).importPublicKey,
        deriveSymmetricKey: deps.deriveSymmetricKey
          ?? (await import('../utils/e2eeHelper.js')).deriveSymmetricKey,
        encryptMessage: deps.encryptMessage
          ?? (await import('../utils/e2eeHelper.js')).encryptMessage,
        encryptFileForE2EE: deps.encryptFileForE2EE
          ?? (await import('../utils/e2eeHelper.js')).encryptFileForE2EE,
        requireE2EEKey: deps.requireE2EEKey
          ?? (await import('../utils/e2eeHelper.js')).requireE2EEKey
      }
    : null;

  if (requiresE2EE && !sharedKey) {
    if (!e2eePrivateKey || !otherMember?.publicKey) {
      e2ee.requireE2EEKey(null);
    }
    const otherPublicKeyObj = await e2ee.importPublicKey(otherMember.publicKey);
    sharedKey = await e2ee.deriveSymmetricKey(e2eePrivateKey, otherPublicKeyObj);
    onSharedKey?.(sharedKey);
  }

  if (item.hasOfflineMedia) {
    const getAttachment = deps.getAttachment
      ?? ((id) => import('../utils/indexedDbHelper.js')
        .then(({ getOfflineAttachment }) => getOfflineAttachment(id, currentUser.id)));

    const blob = await getAttachment(item.optimisticId);
    if (!blob) throw new Error('Файл вложения не найден в локальном хранилище.');

    const extensionForMedia = deps.extensionForMedia ?? defaultExtensionForMedia;
    const storage = deps.storage
      ?? (await import('../supabaseClient.js')).supabase.storage;

    const fileExt = extensionForMedia(blob.type, item.mediaType);
    const fileName = `msg_${item.optimisticId}.${fileExt}`;
    const filePath = `${item.chatId}/${item.senderId}/${fileName}`;
    const blobToUpload = requiresE2EE
      ? await e2ee.encryptFileForE2EE(blob, sharedKey)
      : blob;

    const { error: uploadError } = await storage
      .from('chat-attachments')
      .upload(filePath, blobToUpload, {
        contentType: requiresE2EE ? 'application/octet-stream' : blob.type
      });

    // The object path is deterministic. A 409 means an earlier attempt uploaded
    // this same queue item's object before its response/message insert failed.
    if (uploadError && !isAlreadyUploaded(uploadError)) throw uploadError;
    const { createStorageReference } = await import('../utils/urlSecurity.js');
    finalMediaUrl = createStorageReference('chat-attachments', filePath);
  }

  let textToSend = item.text;
  let mediaToSend = finalMediaUrl;

  if (requiresE2EE) {
    e2ee.requireE2EEKey(sharedKey);
    if (item.text) {
      const encryptedText = await e2ee.encryptMessage(item.text, sharedKey);
      textToSend = `e2ee:aes-gcm:${encryptedText.ciphertext}:${encryptedText.iv}`;
    }
    if (finalMediaUrl) {
      const encryptedMedia = await e2ee.encryptMessage(finalMediaUrl, sharedKey);
      mediaToSend = `e2ee:aes-gcm:${encryptedMedia.ciphertext}:${encryptedMedia.iv}`;
    }
  }

  const sendMessage = deps.sendMessage
    ?? (await import('./dataLayer.js')).dataService.sendMessage.bind(
      (await import('./dataLayer.js')).dataService
    );

  let data;
  try {
    data = await sendMessage(
      item.chatId,
      item.senderId,
      textToSend,
      item.replyToId,
      mediaToSend,
      item.optimisticId
    );
  } catch (error) {
    if (!isDuplicateMessageId(error)) throw error;
    const findMessageById = deps.findMessageById ?? (async (messageId) => {
      const client = (await import('../supabaseClient.js')).supabase;
      const { data: existing, error: lookupError } = await client
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      return existing;
    });
    const existing = await findMessageById(item.optimisticId);
    if (!existing || existing.id !== item.optimisticId
      || existing.chat_id !== item.chatId || existing.sender_id !== item.senderId) {
      throw error;
    }
    data = existing;
  }

  if (data && item.hasOfflineMedia) {
    const deleteAttachment = deps.deleteAttachment
      ?? (await import('../utils/indexedDbHelper.js')).deleteOfflineAttachment;
    try {
      await deleteAttachment(item.optimisticId);
    } catch (error) {
      // Delivery already succeeded. Local cleanup must not turn it into a
      // failed message and trigger another send attempt.
      console.error('Failed to delete delivered offline attachment:', error);
    }
  }

  return { data, finalMediaUrl };
}
