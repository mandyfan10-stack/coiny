// @ts-check
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
import { requireClient } from './serviceUtils.ts';

export {
  isNetworkError,
  createOfflineQueueItem
};

export const loadOfflineQueue = loadEncryptedOfflineQueue;
export const saveOfflineQueue = saveEncryptedOfflineQueue;

/** @param {any} error storage error */
function isAlreadyUploaded(error) {
  return Number(error?.statusCode ?? error?.status) === 409;
}

/** @param {any} error PostgREST error */
function isDuplicateMessageId(error) {
  return error?.code === '23505';
}

/** @typedef {typeof import('../utils/e2eeHelper.js')} E2EEHelper */

/**
 * @typedef {object} AttachmentStorage
 * @property {(bucket: string) => {
 *   upload(path: string, body: Blob, options: { contentType: string }): PromiseLike<{ error: any }>
 * }} from
 */

/**
 * @typedef {object} OfflineQueueDeps
 * @property {import('../types').Chat} chat
 * @property {{ id: string }} currentUser
 * @property {CryptoKey | null} [e2eePrivateKey]
 * @property {CryptoKey | null} [sharedKey] cached shared key for the chat, if known
 * @property {(key: CryptoKey) => void} [onSharedKey] receives a freshly derived shared key
 * @property {E2EEHelper['importPublicKey']} [importPublicKey]
 * @property {E2EEHelper['deriveSymmetricKey']} [deriveSymmetricKey]
 * @property {E2EEHelper['encryptMessage']} [encryptMessage]
 * @property {E2EEHelper['encryptFileForE2EE']} [encryptFileForE2EE]
 * @property {E2EEHelper['requireE2EEKey']} [requireE2EEKey]
 * @property {(id: string) => Promise<Blob | null | undefined>} [getAttachment]
 * @property {(id: string) => Promise<unknown>} [deleteAttachment]
 * @property {typeof defaultExtensionForMedia} [extensionForMedia]
 * @property {AttachmentStorage} [storage]
 * @property {(...args: any[]) => Promise<any>} [sendMessage]
 * @property {(messageId: string) => Promise<any>} [findMessageById]
 */

/**
 * Upload offline media (if any), optionally E2EE-encrypt, and send the message.
 * Every optional dependency is injectable for unit tests.
 *
 * @param {import('../types').OfflineQueueItem} item - offline queue entry
 * @param {OfflineQueueDeps} deps
 * @returns {Promise<{ data: any, finalMediaUrl: string|null }>}
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
  /** @type {CryptoKey | null | undefined} */
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

  // `e2ee` is non-null exactly when `requiresE2EE`; the casts below restate that.
  const e2eeOps = /** @type {NonNullable<typeof e2ee>} */ (e2ee);

  if (requiresE2EE && !sharedKey) {
    if (!e2eePrivateKey || !otherMember?.publicKey) {
      e2eeOps.requireE2EEKey(null);
    }
    const peer = /** @type {NonNullable<typeof otherMember>} */ (otherMember);
    const otherPublicKeyObj = await e2eeOps.importPublicKey(/** @type {string} */ (peer.publicKey));
    sharedKey = await e2eeOps.deriveSymmetricKey(/** @type {CryptoKey} */ (e2eePrivateKey), otherPublicKeyObj);
    onSharedKey?.(sharedKey);
  }

  if (item.hasOfflineMedia) {
    const getAttachment = deps.getAttachment
      ?? ((/** @type {string} */ id) => import('../utils/indexedDbHelper.js')
        .then(({ getOfflineAttachment }) => getOfflineAttachment(id, currentUser.id)));

    const blob = await getAttachment(item.optimisticId);
    if (!blob) throw new Error('Файл вложения не найден в локальном хранилище.');

    const extensionForMedia = deps.extensionForMedia ?? defaultExtensionForMedia;
    const storage = deps.storage
      ?? requireClient((await import('../supabaseClient.js')).supabase).storage;

    const fileExt = extensionForMedia(blob.type, /** @type {string} */ (item.mediaType));
    const fileName = `msg_${item.optimisticId}.${fileExt}`;
    const filePath = `${item.chatId}/${item.senderId}/${fileName}`;
    const blobToUpload = requiresE2EE
      ? await e2eeOps.encryptFileForE2EE(blob, sharedKey)
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
  let forwardedFrom = item.forwardedFrom ? JSON.stringify(item.forwardedFrom) : null;

  if (requiresE2EE) {
    // Guard only: injected test doubles may not return the key.
    e2eeOps.requireE2EEKey(sharedKey);
    const key = /** @type {CryptoKey} */ (sharedKey);
    if (item.text) {
      const encryptedText = await e2eeOps.encryptMessage(item.text, key);
      textToSend = `e2ee:aes-gcm:${encryptedText.ciphertext}:${encryptedText.iv}`;
    }
    if (forwardedFrom) {
      const encrypted = await e2eeOps.encryptMessage(forwardedFrom, key);
      forwardedFrom = `e2ee:aes-gcm:${encrypted.ciphertext}:${encrypted.iv}`;
    }
    if (finalMediaUrl) {
      const encryptedMedia = await e2eeOps.encryptMessage(finalMediaUrl, key);
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
      item.optimisticId,
      ...(forwardedFrom ? [{ forwardedFrom }] : [])
    );
  } catch (error) {
    if (!isDuplicateMessageId(error)) throw error;
    const findMessageById = deps.findMessageById ?? (async (/** @type {string} */ messageId) => {
      const client = requireClient((await import('../supabaseClient.js')).supabase);
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
