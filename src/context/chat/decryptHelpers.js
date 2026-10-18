import {
  importPublicKey,
  deriveSymmetricKey,
  decryptMessage
} from '../../utils/e2eeHelper.js';
import { decodeMessageContent } from '../../utils/messageContent.ts';

/**
 * Decrypt a single message's text/media fields when E2EE ciphertext is present.
 * @param {object} message
 * @param {CryptoKey|null} sharedKey
 * @param {boolean} isPersonal
 */
export async function decryptMessageFields(message, sharedKey, isPersonal) {
  let decryptedText = message.text;
  let decryptedMedia = message.media;
  let isDecrypted = true;
  let forwardedFromRaw = message.forwardedFromRaw;
  if (forwardedFromRaw?.startsWith('e2ee:aes-gcm:')) {
    try {
      if (!sharedKey) throw new Error('Missing key');
      const [ciphertext, iv] = forwardedFromRaw.slice('e2ee:aes-gcm:'.length).split(':');
      forwardedFromRaw = await decryptMessage(ciphertext, iv, sharedKey);
    } catch { forwardedFromRaw = null; }
  }

  if (!isPersonal) {
    return decodeMessageContent({ ...message, text: decryptedText, media: decryptedMedia, ...('forwardedFromRaw' in message ? { forwardedFromRaw } : {}), isLocked: false });
  }

  if (message.text && message.text.startsWith('e2ee:aes-gcm:')) {
    if (sharedKey) {
      try {
        const parts = message.text.replace('e2ee:aes-gcm:', '').split(':');
        decryptedText = await decryptMessage(parts[0], parts[1], sharedKey);
      } catch {
        decryptedText = 'Зашифрованное сообщение';
        isDecrypted = false;
      }
    } else {
      decryptedText = 'Зашифрованное сообщение';
      isDecrypted = false;
    }
  }

  if (message.media && message.media.startsWith('e2ee:aes-gcm:')) {
    if (sharedKey && isDecrypted) {
      try {
        const parts = message.media.replace('e2ee:aes-gcm:', '').split(':');
        decryptedMedia = await decryptMessage(parts[0], parts[1], sharedKey);
      } catch {
        decryptedMedia = null;
      }
    } else {
      decryptedMedia = null;
    }
  }

  return decodeMessageContent({ ...message, text: decryptedText, media: decryptedMedia, ...('forwardedFromRaw' in message ? { forwardedFromRaw } : {}), isLocked: !isDecrypted });
}

/**
 * Resolve or derive the ECDH shared key for a personal chat.
 */
export async function resolveSharedKey({
  chatId,
  chat,
  currentUserId,
  e2eePrivateKey,
  sharedKeysCache,
  setSharedKeysCache
}) {
  if (!chat || chat.type !== 'personal') return null;

  let sharedKey = sharedKeysCache[chatId];
  if (sharedKey) return sharedKey;
  if (!e2eePrivateKey) return null;

  const otherMember = chat.members?.find((m) => m.id !== currentUserId);
  if (!otherMember?.publicKey) return null;

  try {
    const otherPublicKeyObj = await importPublicKey(otherMember.publicKey);
    sharedKey = await deriveSymmetricKey(e2eePrivateKey, otherPublicKeyObj);
    setSharedKeysCache((prev) => ({ ...prev, [chatId]: sharedKey }));
    return sharedKey;
  } catch (err) {
    console.error('Failed to derive shared key:', err);
    return null;
  }
}
