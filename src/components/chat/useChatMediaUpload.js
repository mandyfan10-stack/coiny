import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../supabaseClient';
import {
  importPublicKey,
  deriveSymmetricKey,
  encryptFileForE2EE,
  requireE2EEKey,
} from '../../utils/e2eeHelper';
import { extensionForMedia, validateChatMedia } from '../../utils/mediaValidation';
import { createStorageReference } from '../../utils/urlSecurity';
import { isNetworkError } from '../../services/offlineQueueCore';
import {
  MAX_RECORDING_BYTES,
  getAttachmentCaption,
  getRecordingCaption,
  getRecordingMediaType,
  isPastableMediaType,
} from './chatAreaModel.ts';

const ATTACHMENTS_BUCKET = 'chat-attachments';

function readAsDataUrl(blob, onLoad) {
  const reader = new FileReader();
  reader.onload = event => onLoad(event.target.result);
  reader.readAsDataURL(blob);
}

/**
 * Attachment and recording uploads for the active chat. Personal E2EE chats
 * encrypt before upload and never fall back to plaintext; offline or network
 * failures hand the raw blob to the offline queue via `sendMessage`.
 */
export default function useChatMediaUpload({
  activeChat,
  currentUser,
  requiresE2EE,
  otherMember,
  sharedKeysCache,
  setSharedKeysCache,
  e2eePrivateKey,
  sendMessage,
  replyingTo,
  setReplyingTo,
  isBlocked,
  fileInputRef,
}) {
  const [uploading, setUploading] = useState(false);

  const resolveSharedKeyForUpload = async () => {
    if (!requiresE2EE) return null;

    let sharedKey = sharedKeysCache[activeChat.id];
    if (!sharedKey && e2eePrivateKey && otherMember?.publicKey) {
      try {
        const publicKey = await importPublicKey(otherMember.publicKey);
        sharedKey = await deriveSymmetricKey(e2eePrivateKey, publicKey);
        setSharedKeysCache(previous => ({ ...previous, [activeChat.id]: sharedKey }));
      } catch (cause) {
        throw new Error('Не удалось подготовить ключ шифрования. Файл не был загружен.', { cause });
      }
    }

    return requireE2EEKey(sharedKey);
  };

  const prepareBlobForUpload = async blob => (
    requiresE2EE ? encryptFileForE2EE(blob, await resolveSharedKeyForUpload()) : blob
  );

  const uploadToAttachments = async (fileName, blob, contentType) => {
    const filePath = `${activeChat.id}/${currentUser.id}/${fileName}`;
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(filePath, blob, { contentType });
    if (error) throw error;
    return createStorageReference(ATTACHMENTS_BUCKET, filePath);
  };

  const uploadFileDirectly = async (file, mediaInfo = validateChatMedia(file)) => {
    setUploading(true);
    const messageId = crypto.randomUUID();
    const mediaType = mediaInfo.kind;
    const caption = getAttachmentCaption(mediaType);
    const queueOffline = () => {
      sendMessage(caption, replyingTo?.id, null, file, mediaType, messageId);
      setReplyingTo(null);
    };

    try {
      if (isSupabaseConfigured) {
        if (!navigator.onLine) {
          queueOffline();
          return;
        }
        const blobToUpload = await prepareBlobForUpload(file);
        const reference = await uploadToAttachments(
          `msg_${messageId}.${mediaInfo.extension}`,
          blobToUpload,
          requiresE2EE ? 'application/octet-stream' : mediaInfo.mimeType,
        );
        sendMessage(caption, replyingTo?.id, reference, null, null, messageId);
      } else {
        readAsDataUrl(file, dataUrl => sendMessage(caption, replyingTo?.id, dataUrl, null, null, messageId));
      }
      setReplyingTo(null);
    } catch (err) {
      console.error('Upload error:', err);
      if (isNetworkError(err)) queueOffline();
      else alert('Ошибка при загрузке: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const uploadAndSendRecord = async (blob, mode) => {
    setUploading(true);
    const mediaType = getRecordingMediaType(mode);
    const caption = getRecordingCaption(mode);
    const queueOffline = () => {
      sendMessage(caption, replyingTo?.id, null, blob, mediaType);
      setReplyingTo(null);
    };

    try {
      if (blob.size > MAX_RECORDING_BYTES) {
        alert('Запись слишком длинная и превышает лимит 15 МБ.');
        return;
      }

      if (isSupabaseConfigured) {
        if (!navigator.onLine) {
          queueOffline();
          return;
        }
        // E2EE chats must never fall back to uploading plaintext.
        const blobToUpload = await prepareBlobForUpload(blob);
        const reference = await uploadToAttachments(
          `record_${crypto.randomUUID()}.${extensionForMedia(blob.type, mediaType)}`,
          blobToUpload,
          blobToUpload.type || blob.type,
        );
        sendMessage(caption, replyingTo?.id, reference);
      } else {
        readAsDataUrl(blob, dataUrl => sendMessage(caption, replyingTo?.id, dataUrl));
      }
      setReplyingTo(null);
    } catch (err) {
      console.error('Upload recording error:', err);
      if (isNetworkError(err)) queueOffline();
      else alert('Ошибка при сохранении сообщения: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (event) => {
    if (isBlocked) return;
    const file = event.target.files[0];
    if (!file) return;

    try {
      await uploadFileDirectly(file, validateChatMedia(file));
    } catch (error) {
      alert(error.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (event) => {
    if (isBlocked) return;
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (!isPastableMediaType(item.type)) continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      try {
        await uploadFileDirectly(file, validateChatMedia(file));
      } catch (error) {
        alert(error.message);
      }
      break;
    }
  };

  return { uploading, uploadAndSendRecord, handleFileChange, handlePaste };
}
