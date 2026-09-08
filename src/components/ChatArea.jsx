import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import './ChatArea.css';
import coinyLogo from '../assets/logo.png';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import {
  Send,
  Paperclip,
  Smile,
  Mic,
  X,
  ArrowDown,
  Play,
  Pause,
  Lock,
  Trash2,
  WifiOff,
  CornerUpLeft,
  Camera,
  Video
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';
import {
  importPublicKey,
  deriveSymmetricKey,
  encryptFileForE2EE,
  requireE2EEKey
} from '../utils/e2eeHelper';
import { CHAT_MEDIA_ACCEPT, extensionForMedia, validateChatMedia } from '../utils/mediaValidation';
import {
  getSupportedRecordingMimeTypes,
  normalizeRecordingMimeType,
} from '../utils/mediaRecording';
import { requiresPersonalE2EE } from '../utils/savedMessages';
import ChatHeader from './chat/ChatHeader';
import MessageBubble from './chat/MessageBubble';
import ImageViewer from './chat/ImageViewer';
import MediaPickerPanel from './chat/MediaPickerPanel';
import { createStorageReference } from '../utils/urlSecurity';
import { getReplyType } from '../utils/mobileActionSheetUtils';
import useResolvedMedia from '../hooks/useResolvedMedia';
import useEdgeSwipeBack from '../hooks/useSwipeGesture';
import ChatSkeleton from './chat/ChatSkeleton';

export default function ChatArea() {
  const {
    activeChat,
    getChatStatus,
    sendMessage,
    deleteMessage,
    toggleReaction,
    isInfoOpen,
    setIsInfoOpen,
    typingStatuses,
    sendTypingStatus,
    wallpaper,
    renderAvatar,
    installedStickers,
    setActiveChatId,
    isOnline,
    retrySendMessage,
    deleteFailedMessage,
    loadOlderMessages,
    messagePagination,
    isChatLoading,
    isSyncing,
    setIsSettingsOpen,
    setSettingsTab
  } = useChat();

  const { currentUser } = useAuth();
  const { sharedKeysCache, setSharedKeysCache, e2eePrivateKey } = useE2EE();

  const isOwner = activeChat && currentUser && (
    activeChat.createdBy === currentUser.id ||
    activeChat.createdBy === 'current'
  );

  const canPost = !activeChat?.requiresUpdate && (!activeChat ||
    activeChat.type === 'personal' ||
    isOwner ||
    (activeChat.type === 'group' && !activeChat.settings?.only_admins_can_post));

  const canSendMedia = !activeChat ||
    activeChat.type === 'personal' ||
    isOwner ||
    activeChat.settings?.allow_media !== false;

  useEdgeSwipeBack({
    onSwipeBack: () => {
      if (activeChat) {
        setActiveChatId(null);
      }
    },
    enabled: Boolean(activeChat)
  });

  const otherMember = activeChat?.type === 'personal'
    ? activeChat.members?.find(m => m.id !== currentUser?.id)
    : null;
  const requiresE2EE = requiresPersonalE2EE(activeChat);
  const recipientMissingE2EE = requiresE2EE && (!otherMember || !otherMember.hasE2ee);

  const chatMessagesCount = activeChat?.messages?.length || 0;
  const isInitialLoading = Boolean(isChatLoading?.[activeChat?.id] && chatMessagesCount === 0);

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

  const isCustomWallpaper = Boolean(wallpaper && wallpaper !== 'classic' && wallpaper !== 'default');
  const { url: resolvedWallpaper } = useResolvedMedia(
    isCustomWallpaper ? wallpaper : null,
    null,
    'image/webp'
  );
  const isDirectWallpaper = Boolean(isCustomWallpaper && (
    wallpaper.startsWith('data:') ||
    wallpaper.startsWith('blob:') ||
    wallpaper.startsWith('http://') ||
    wallpaper.startsWith('https://')
  ));
  const activeWallpaperUrl = resolvedWallpaper || (isDirectWallpaper ? wallpaper : null);
  const chatBodyStyle = isCustomWallpaper ? {
    backgroundImage: activeWallpaperUrl ? `url("${activeWallpaperUrl}")` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  } : {};

  const [inputVal, setInputVal] = useState('');
  const [retryMenuMsgId, setRetryMenuMsgId] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showMsgActionsId, setShowMsgActionsId] = useState(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [openedImageUrl, setOpenedImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isCurrentlyTyping, setIsCurrentlyTyping] = useState(false);
  const isCurrentlyTypingRef = useRef(isCurrentlyTyping);
  const isRecordingRef = useRef(false);
  const sendTypingStatusRef = useRef(sendTypingStatus);
  const stopRecordingAndSendRef = useRef(null);
  isCurrentlyTypingRef.current = isCurrentlyTyping;
  sendTypingStatusRef.current = sendTypingStatus;

  const [recordMode, setRecordMode] = useState('voice'); // 'voice' or 'video'
  const [isRecording, setIsRecording] = useState(false);
  isRecordingRef.current = isRecording;
  const [isRecordingStarting, setIsRecordingStarting] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);

  const messagesEndRef = useRef(null);
  const chatBodyRef = useRef(null);
  const isLoadingOlderRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const textareaRef = useRef(null);
  const emojiRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const holdTimeoutRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordStartX = useRef(0);
  const recordStartY = useRef(0);
  const isCancelledRef = useRef(false);
  const isLockedRef = useRef(false);
  const isPausedRef = useRef(false);
  const isRecordingStartingRef = useRef(false);
  const pointerReleasedRef = useRef(true);
  const activeRecordPointerIdRef = useRef(null);
  const recordPointerMoveHandlerRef = useRef(null);
  const recordPointerUpHandlerRef = useRef(null);
  const recordPointerCancelHandlerRef = useRef(null);
  const [isLockActive, setIsLockActive] = useState(false);
  const isLockActiveRef = useRef(false);
  const videoPreviewRef = useRef(null);

  const emojis = ['😀', '😂', '😍', '👍', '🔥', '🎉', '👏', '❤️', '🤔', '👀', '✨', '🚀', '💯', '😎'];

  const uploadFileDirectly = async (file, mediaInfo = validateChatMedia(file)) => {
    setUploading(true);
    const messageId = crypto.randomUUID();
    const mediaType = mediaInfo.kind;
    const msgText = mediaType === 'audio'
      ? 'Голосовое сообщение'
      : mediaType === 'video' ? '🎬 [Видео]' : 'Изображение';

    try {
      if (isSupabaseConfigured) {
        if (!navigator.onLine) {
          sendMessage(msgText, replyingTo?.id, null, file, mediaType, messageId);
          setReplyingTo(null);
          return;
        }

        const fileName = `msg_${messageId}.${mediaInfo.extension}`;
        const filePath = `${activeChat.id}/${currentUser.id}/${fileName}`;
        const blobToUpload = requiresE2EE
          ? await encryptFileForE2EE(file, await resolveSharedKeyForUpload())
          : file;

        const { error } = await supabase.storage
          .from('chat-attachments')
          .upload(filePath, blobToUpload, {
            contentType: requiresE2EE ? 'application/octet-stream' : mediaInfo.mimeType
          });

        if (error) throw error;
        sendMessage(
          msgText,
          replyingTo?.id,
          createStorageReference('chat-attachments', filePath),
          null,
          null,
          messageId
        );
      } else {
        const reader = new FileReader();
        reader.onload = (event) => sendMessage(msgText, replyingTo?.id, event.target.result, null, null, messageId);
        reader.readAsDataURL(file);
      }
      setReplyingTo(null);
    } catch (err) {
      console.error('Upload error:', err);
      const isNetworkError = !navigator.onLine || err.message?.includes('FetchError') || err.message?.includes('failed to fetch');
      if (isNetworkError) {
        sendMessage(msgText, replyingTo?.id, null, file, mediaType, messageId);
        setReplyingTo(null);
      } else {
        alert('Ошибка при загрузке: ' + err.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await uploadFileDirectly(file, validateChatMedia(file));
    } catch (error) {
      alert(error.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (!item.type.startsWith('image/') && !item.type.startsWith('audio/') && !item.type.startsWith('video/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      try {
        await uploadFileDirectly(file, validateChatMedia(file));
      } catch (error) {
        alert(error.message);
      }
      break;
    }
  };

function formatDateDivider(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Сегодня';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Вчера';
  }
  const isThisYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: isThisYear ? undefined : 'numeric'
  });
}

  // Auto-scroll to bottom on chat switch or new message
  const scrollToBottom = (behavior = 'smooth') => {
    if (chatBodyRef.current) {
      if (behavior === 'auto') {
        chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior });
      }
    }
  };

  const SCROLL_STORAGE_KEY_PREFIX = 'coingram_chat_scroll_';

  const getSavedChatScroll = (chatId) => {
    if (!chatId || typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(`${SCROLL_STORAGE_KEY_PREFIX}${chatId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const saveChatScroll = (chatId, data) => {
    if (!chatId || typeof window === 'undefined') return;
    try {
      localStorage.setItem(`${SCROLL_STORAGE_KEY_PREFIX}${chatId}`, JSON.stringify(data));
    } catch {}
  };

  const isInitialChatLoadRef = useRef(true);
  const currentChatIdRef = useRef(activeChat?.id);
  const chatScrollPositionsRef = useRef(new Map());

  const saveCurrentScrollPosition = useCallback(() => {
    const element = chatBodyRef.current;
    if (!element || !activeChat?.id) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    const messageRows = element.querySelectorAll('.message-row[data-message-id]');
    let topMessageId = null;
    const containerTop = element.getBoundingClientRect().top;
    for (const row of messageRows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > containerTop + 15) {
        topMessageId = row.getAttribute('data-message-id');
        break;
      }
    }

    const scrollData = {
      scrollTop,
      scrollHeight,
      distanceFromBottom,
      topMessageId,
      timestamp: Date.now()
    };

    chatScrollPositionsRef.current.set(activeChat.id, scrollData);
    saveChatScroll(activeChat.id, scrollData);
  }, [activeChat?.id]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentScrollPosition();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      saveCurrentScrollPosition();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveCurrentScrollPosition]);

  useLayoutEffect(() => {
    if (currentChatIdRef.current !== activeChat?.id) {
      currentChatIdRef.current = activeChat?.id;
      isInitialChatLoadRef.current = true;
    }
    if (isInitialLoading) return;
    if (isInitialChatLoadRef.current && chatBodyRef.current && (activeChat?.messages?.length || 0) > 0) {
      const unreadCount = activeChat?.unread_count || 0;
      if (unreadCount > 0) {
        const unreadEl = chatBodyRef.current.querySelector('.unread-messages-divider');
        if (unreadEl) {
          unreadEl.scrollIntoView({ block: 'center', behavior: 'auto' });
          isInitialChatLoadRef.current = false;
          return;
        }
      }

      const saved = chatScrollPositionsRef.current.get(activeChat?.id) || getSavedChatScroll(activeChat?.id);
      if (saved) {
        if (saved.distanceFromBottom < 60) {
          chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
          isInitialChatLoadRef.current = false;
          return;
        }
        if (saved.topMessageId) {
          const targetMsg = chatBodyRef.current.querySelector(`.message-row[data-message-id="${saved.topMessageId}"]`);
          if (targetMsg) {
            targetMsg.scrollIntoView({ block: 'start', behavior: 'auto' });
            isInitialChatLoadRef.current = false;
            return;
          }
        }
        if (typeof saved.scrollTop === 'number') {
          chatBodyRef.current.scrollTop = saved.scrollTop;
          isInitialChatLoadRef.current = false;
          return;
        }
      }

      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      isInitialChatLoadRef.current = false;
    }
  }, [activeChat?.id, activeChat?.messages, activeChat?.unread_count, isInitialLoading]);

  useEffect(() => {
    const saved = chatScrollPositionsRef.current.get(activeChat?.id) || getSavedChatScroll(activeChat?.id);
    if (saved) {
      if (saved.distanceFromBottom < 60) {
        scrollToBottom('auto');
      } else if (saved.topMessageId) {
        const targetMsg = chatBodyRef.current?.querySelector(`.message-row[data-message-id="${saved.topMessageId}"]`);
        if (targetMsg) {
          targetMsg.scrollIntoView({ block: 'start', behavior: 'auto' });
        } else if (typeof saved.scrollTop === 'number' && chatBodyRef.current) {
          chatBodyRef.current.scrollTop = saved.scrollTop;
        }
      } else if (typeof saved.scrollTop === 'number' && chatBodyRef.current) {
        chatBodyRef.current.scrollTop = saved.scrollTop;
      }
    } else {
      scrollToBottom('auto');
    }
    shouldAutoScrollRef.current = saved ? (saved.distanceFromBottom < 120) : true;
    setReplyingTo(null);
    setOpenedImageUrl(null);
    setInputVal('');

    if (isCurrentlyTypingRef.current) {
      setIsCurrentlyTyping(false);
      sendTypingStatusRef.current(activeChat?.id, false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (isRecordingRef.current) {
      stopRecordingAndSendRef.current?.(true);
    }
  }, [activeChat?.id]);

  useEffect(() => {
    const handleGlobalPointerMove = (event) => recordPointerMoveHandlerRef.current?.(event);
    const handleGlobalPointerUp = (event) => recordPointerUpHandlerRef.current?.(event);
    const handleGlobalPointerCancel = (event) => recordPointerCancelHandlerRef.current?.(event);

    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: false });
    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerCancel);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch (error) {
          console.error('Failed to stop recorder during cleanup:', error);
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const startRecording = async (mode) => {
    if (isRecordingStartingRef.current || isRecordingRef.current) return;

    isRecordingStartingRef.current = true;
    setIsRecordingStarting(true);

    try {
      const constraints = mode === 'voice'
        ? { audio: true, video: false }
        : { audio: true, video: { width: { ideal: 320 }, height: { ideal: 320 }, facingMode: 'user' } };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Permission prompts on mobile can outlive the original press. Never begin a
      // recording after the user has already released or cancelled that gesture.
      if (pointerReleasedRef.current || isCancelledRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;

      if (mode === 'video') {
        setTimeout(() => {
          if (videoPreviewRef.current) {
            try {
              videoPreviewRef.current.srcObject = stream;
              videoPreviewRef.current.play().catch(e => console.error('Preview play failed', e));
            } catch (error) {
              console.error('Preview setup failed', error);
            }
          }
        }, 50);
      }

      const chunks = [];
      mediaChunksRef.current = chunks;

      const supportedMimeTypes = getSupportedRecordingMimeTypes(mode, MediaRecorder);
      let recorder = null;
      let lastRecorderError = null;
      for (const mimeType of [...supportedMimeTypes, null]) {
        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
          break;
        } catch (error) {
          lastRecorderError = error;
        }
      }
      if (!recorder) throw lastRecorderError || new Error('MediaRecorder is unavailable');

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        isRecordingRef.current = false;
        const recordedMimeType = normalizeRecordingMimeType(
          recorder.mimeType || chunks[0]?.type,
          mode,
        );
        cleanupRecordingState();

        if (isCancelledRef.current) {
          console.log('Recording cancelled, discarding chunks.');
          return;
        }

        const blob = new Blob(chunks, { type: recordedMimeType });
        if (blob.size === 0) {
          alert('Запись получилась пустой. Проверьте доступ к микрофону или камере и попробуйте ещё раз.');
          return;
        }

        await uploadAndSendRecord(blob, mode);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);

      isRecordingRef.current = true;
      setIsRecording(true);
      isRecordingStartingRef.current = false;
      setIsRecordingStarting(false);
      setRecordDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Failed to start recording:', err);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      alert('Не удалось получить доступ к микрофону/камере: ' + err.message);
      cleanupRecordingState();
    } finally {
      if (!isRecordingRef.current) {
        isRecordingStartingRef.current = false;
        setIsRecordingStarting(false);
      }
    }
  };

  const stopRecordingAndSend = (isCancel = false) => {
    if (isCancel) {
      isCancelledRef.current = true;
    }

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        isRecordingRef.current = false;
        mediaRecorderRef.current.stop();
      } else {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        cleanupRecordingState();
      }
    } catch (e) {
      console.error("Error stopping media recorder:", e);
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach(track => track.stop());
        } catch (e2) {
          console.error("Error stopping tracks in fallback:", e2);
        }
      }
      cleanupRecordingState();
    }
  };

  stopRecordingAndSendRef.current = stopRecordingAndSend;

  const pauseRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.pause();
      }
    } catch (e) {
      console.error("Failed to pause media recorder:", e);
    }

    setIsRecordingPaused(true);
    isPausedRef.current = true;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recordMode === 'video' && videoPreviewRef.current) {
      try {
        videoPreviewRef.current.pause();
      } catch (e) {
        console.error("Preview pause failed", e);
      }
    }
  };

  const resumeRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
      }
    } catch (e) {
      console.error("Failed to resume media recorder:", e);
    }

    setIsRecordingPaused(false);
    isPausedRef.current = false;

    if (!recordingTimerRef.current) {
      recordingTimerRef.current = setInterval(() => {
        setRecordDuration(prev => prev + 1);
      }, 1000);
    }

    if (recordMode === 'video' && videoPreviewRef.current) {
      videoPreviewRef.current.play().catch(e => console.error("Preview resume play failed", e));
    }
  };

  const cleanupRecordingState = () => {
    isRecordingRef.current = false;
    isRecordingStartingRef.current = false;
    setIsRecording(false);
    setIsRecordingStarting(false);
    setIsRecordingLocked(false);
    setIsRecordingPaused(false);
    isLockedRef.current = false;
    isPausedRef.current = false;
    pointerReleasedRef.current = true;
    activeRecordPointerIdRef.current = null;
    setIsLockActive(false);
    isLockActiveRef.current = false;
    setRecordDuration(0);
    if (videoPreviewRef.current) {
      try {
        videoPreviewRef.current.srcObject = null;
      } catch (e) {
        console.error("Failed to clean up video preview:", e);
      }
    }
  };

  const uploadAndSendRecord = async (blob, mode) => {
    setUploading(true);
    try {
      const MAX_SIZE = 15 * 1024 * 1024;
      if (blob.size > MAX_SIZE) {
        alert("Запись слишком длинная и превышает лимит 15 МБ.");
        return;
      }

      const isVoice = mode === 'voice';
      const mediaType = isVoice ? 'audio' : 'video';
      const msgText = isVoice ? 'Голосовое сообщение' : 'Видеосообщение';

      if (isSupabaseConfigured) {
        if (!navigator.onLine) {
          sendMessage(msgText, replyingTo?.id, null, blob, mediaType);
          setReplyingTo(null);
          return;
        }

        const fileExt = extensionForMedia(blob.type, mediaType);
        const fileName = `record_${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${activeChat.id}/${currentUser.id}/${fileName}`;

        // E2EE chats must never fall back to uploading plaintext.
        const blobToUpload = requiresE2EE
          ? await encryptFileForE2EE(blob, await resolveSharedKeyForUpload())
          : blob;

        const { error } = await supabase.storage
          .from('chat-attachments')
          .upload(filePath, blobToUpload, {
            contentType: blobToUpload.type || blob.type
          });

        if (error) throw error;

        sendMessage(
          msgText,
          replyingTo?.id,
          createStorageReference('chat-attachments', filePath)
        );
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          sendMessage(msgText, replyingTo?.id, event.target.result);
        };
        reader.readAsDataURL(blob);
      }
      setReplyingTo(null);
    } catch (err) {
      console.error("Upload recording error:", err);
      const isNetworkError = !navigator.onLine || err.message?.includes('FetchError') || err.message?.includes('failed to fetch');
      if (isNetworkError) {
        const isVoice = mode === 'voice';
        const mediaType = isVoice ? 'audio' : 'video';
        const msgText = isVoice ? 'Голосовое сообщение' : 'Видеосообщение';
        sendMessage(msgText, replyingTo?.id, null, blob, mediaType);
        setReplyingTo(null);
      } else {
        alert("Ошибка при сохранении сообщения: " + err.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const releaseRecordPointerCapture = (event) => {
    try {
      if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      console.error('Failed to release recording pointer capture:', error);
    }
  };

  const handlePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (
      activeRecordPointerIdRef.current !== null ||
      isRecordingRef.current ||
      isRecordingStartingRef.current ||
      uploading
    ) return;

    event.preventDefault();
    activeRecordPointerIdRef.current = event.pointerId;
    pointerReleasedRef.current = false;
    recordStartX.current = event.clientX;
    recordStartY.current = event.clientY;
    isCancelledRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;
    setIsRecordingLocked(false);
    setIsRecordingPaused(false);
    setIsLockActive(false);
    isLockActiveRef.current = false;

    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (error) {
      console.error('Failed to capture recording pointer:', error);
    }

    holdTimeoutRef.current = setTimeout(() => {
      holdTimeoutRef.current = null;
      void startRecording(recordMode);
    }, 250);
  };

  const handlePointerMove = (event) => {
    if (event.pointerId !== activeRecordPointerIdRef.current) return;
    if (isLockedRef.current || isCancelledRef.current) return;

    event.preventDefault();
    const diffX = recordStartX.current - event.clientX;
    const diffY = recordStartY.current - event.clientY;

    if (diffX > 100 && diffY < 40) {
      isCancelledRef.current = true;
      pointerReleasedRef.current = true;
      setIsLockActive(false);
      isLockActiveRef.current = false;
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      if (isRecordingRef.current) stopRecordingAndSend(true);
      return;
    }

    if (diffY > 80) {
      if (!isLockActiveRef.current) {
        isLockActiveRef.current = true;
        setIsLockActive(true);
      }
    } else if (diffY < 30 && isLockActiveRef.current) {
      isLockActiveRef.current = false;
      setIsLockActive(false);
    }
  };

  const handlePointerUp = (event) => {
    if (event.pointerId !== activeRecordPointerIdRef.current) return;
    event.preventDefault();
    releaseRecordPointerCapture(event);
    activeRecordPointerIdRef.current = null;
    pointerReleasedRef.current = true;

    if (isCancelledRef.current) return;

    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
      setRecordMode(prev => prev === 'voice' ? 'video' : 'voice');
    } else if (isRecordingStartingRef.current && !isRecordingRef.current) {
      // startRecording will stop the late stream as soon as permission resolves.
      return;
    } else if (isRecordingRef.current) {
      if (isLockActiveRef.current) {
        isLockedRef.current = true;
        setIsRecordingLocked(true);
        return;
      }
      if (isLockedRef.current) return;
      stopRecordingAndSend(false);
    }
  };

  const handlePointerCancel = (event) => {
    if (event.pointerId !== activeRecordPointerIdRef.current) return;
    event.preventDefault();
    releaseRecordPointerCapture(event);
    activeRecordPointerIdRef.current = null;
    pointerReleasedRef.current = true;
    isCancelledRef.current = true;
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (isRecordingRef.current) stopRecordingAndSend(true);
  };

  recordPointerMoveHandlerRef.current = handlePointerMove;
  recordPointerUpHandlerRef.current = handlePointerUp;
  recordPointerCancelHandlerRef.current = handlePointerCancel;

  const latestMessage = activeChat?.messages?.[activeChat.messages.length - 1];
  const latestMessageId = latestMessage?.id;
  const latestMessageSenderId = latestMessage?.senderId;
  const messageCount = activeChat?.messages?.length || 0;
  const prevMessageCountRef = useRef(messageCount);
  const prevLatestMessageIdRef = useRef(latestMessageId);

  useEffect(() => {
    const isNewMessage = (
      messageCount > prevMessageCountRef.current &&
      latestMessageId !== prevLatestMessageIdRef.current
    );
    const isOwnMessage = isNewMessage && (latestMessageSenderId === currentUser?.id || latestMessageSenderId === 'current');

    if (!isLoadingOlderRef.current && isNewMessage) {
      if (shouldAutoScrollRef.current || isOwnMessage) {
        // Own sends jump instantly so smooth-scroll cannot be interrupted by
        // pagination/layout while the row is still off-screen.
        scrollToBottom(isOwnMessage ? 'auto' : 'smooth');
      }
    }

    prevMessageCountRef.current = messageCount;
    prevLatestMessageIdRef.current = latestMessageId;
  }, [activeChat?.id, latestMessageId, latestMessageSenderId, messageCount, currentUser?.id]);

  // Monitor scroll, virtualize off-screen rows, and page backwards near the top.
  const handleScroll = async () => {
    const element = chatBodyRef.current;
    if (!element) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
    if (distanceFromBottom > 120) {
      isInitialChatLoadRef.current = false;
    }
    setShowScrollBottom(distanceFromBottom > 300);

    saveCurrentScrollPosition();

    const page = messagePagination?.[activeChat?.id];
    // Opening a long chat starts at scrollTop 0 until layout restores the
    // bottom/anchor. Paging here would prepend history and leave the view
    // stuck in old messages (breaks live E2E read receipts).
    if (isInitialChatLoadRef.current) return;
    if (scrollTop > 80 || page?.hasMore === false || isLoadingOlderRef.current) return;

    isLoadingOlderRef.current = true;
    const previousHeight = scrollHeight;
    const previousTop = scrollTop;
    try {
      const loaded = await loadOlderMessages(activeChat.id);
      if (loaded > 0) {
        requestAnimationFrame(() => {
          if (chatBodyRef.current) {
            chatBodyRef.current.scrollTop = previousTop + chatBodyRef.current.scrollHeight - previousHeight;
          }
        });
      }
    } finally {
      isLoadingOlderRef.current = false;
    }
  };

  useEffect(() => {
    if (!openedImageUrl) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpenedImageUrl(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openedImageUrl]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
      // Reaction drawer & mobile action sheet are portaled to document.body — include them so emoji clicks
      // and controls are not treated as "outside".
      if (
        !e.target.closest('.message-hover-actions') &&
        !e.target.closest('.reaction-drawer') &&
        !e.target.closest('.mobile-action-sheet') &&
        !e.target.closest('.mobile-action-sheet-backdrop')
      ) {
        setShowMsgActionsId(null);
      }
      if (!e.target.closest('.failed-message-menu') && !e.target.closest('.seen-check.failed')) {
        setRetryMenuMsgId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, []);

  // Touch Gestures for Swipe Back on Mobile
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchMoveRef = useRef({ x: 0, y: 0 });
  const isSwipeGestureRef = useRef(false);
  const mainRef = useRef(null);

  const handleTouchStart = (e) => {
    if (window.innerWidth >= 768 || e.touches.length !== 1) return;
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    if (startX > window.innerWidth * 0.25) {
      touchStartRef.current = { x: 0, y: 0 };
      return;
    }
    touchStartRef.current = { x: startX, y: startY };
    touchMoveRef.current = { x: startX, y: startY };
    isSwipeGestureRef.current = false;
    if (mainRef.current) {
      mainRef.current.style.transition = 'none';
    }
  };

  const handleTouchMove = (e) => {
    if (window.innerWidth >= 768 || e.touches.length !== 1 || touchStartRef.current.x === 0) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartRef.current.x;
    const deltaY = currentY - touchStartRef.current.y;
    touchMoveRef.current = { x: currentX, y: currentY };
    if (!isSwipeGestureRef.current) {
      if (deltaX > 15 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        isSwipeGestureRef.current = true;
      } else if (Math.abs(deltaY) > 15 || deltaX < -15) {
        touchStartRef.current = { x: 0, y: 0 };
      }
    }
    if (isSwipeGestureRef.current && deltaX > 0) {
      e.preventDefault();
      if (mainRef.current) {
        mainRef.current.style.transform = `translate3d(${deltaX}px, 0, 0)`;
      }
    }
  };

  const handleTouchEnd = () => {
    if (window.innerWidth >= 768 || !isSwipeGestureRef.current || touchStartRef.current.x === 0) {
      isSwipeGestureRef.current = false;
      touchStartRef.current = { x: 0, y: 0 };
      return;
    }
    const deltaX = touchMoveRef.current.x - touchStartRef.current.x;
    const threshold = window.innerWidth * 0.25;
    if (mainRef.current) {
      mainRef.current.style.transition = 'transform 0.24s cubic-bezier(0.1, 0.76, 0.55, 0.94)';
    }
    if (deltaX > threshold) {
      if (mainRef.current) {
        mainRef.current.style.transform = 'translate3d(100%, 0, 0)';
      }
      setTimeout(() => {
        setActiveChatId(null);
        if (mainRef.current) {
          mainRef.current.style.transform = '';
          mainRef.current.style.transition = '';
        }
      }, 240);
    } else {
      if (mainRef.current) {
        mainRef.current.style.transform = '';
      }
      setTimeout(() => {
        if (mainRef.current) {
          mainRef.current.style.transition = '';
        }
      }, 240);
    }
    isSwipeGestureRef.current = false;
    touchStartRef.current = { x: 0, y: 0 };
  };

  if (!activeChat) {
    return (
      <main className="chat-area empty">
        <div className="empty-state">
          <div className="empty-state-logo">
            <img src={coinyLogo} alt="Coiny" className="empty-state-logo-img" width="76" height="76" />
          </div>
          <h3>Выберите чат, чтобы начать общение</h3>
          <p>Или откройте историю в списке чатов</p>
        </div>
      </main>
    );
  }

  const handleSend = () => {
    if (!inputVal.trim()) return;
    sendMessage(inputVal, replyingTo?.id);
    setInputVal('');
    setReplyingTo(null);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    setIsCurrentlyTyping(false);
    sendTypingStatus(activeChat.id, false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };


  const handleInputChange = (e) => {
    setInputVal(e.target.value);

    if (!isCurrentlyTyping) {
      setIsCurrentlyTyping(true);
      sendTypingStatus(activeChat.id, true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsCurrentlyTyping(false);
      sendTypingStatus(activeChat.id, false);
    }, 3000);
  };

  const handleEmojiClick = (emoji) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart ?? inputVal.length;
      const end = textarea.selectionEnd ?? inputVal.length;
      const nextVal = inputVal.substring(0, start) + emoji + inputVal.substring(end);
      setInputVal(nextVal);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setInputVal(prev => prev + emoji);
    }
  };

  const typingUsersInChat = typingStatuses[activeChat.id] ? Object.values(typingStatuses[activeChat.id]) : [];
  const isTypingText = typingUsersInChat.length > 0
    ? `${typingUsersInChat.join(', ')} ${typingUsersInChat.length > 1 ? 'печатают' : 'печатает'}...`
    : null;

  return (
    <main 
      className="chat-area"
      ref={mainRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <ChatHeader
        activeChat={activeChat}
        renderAvatar={renderAvatar}
        getChatStatus={getChatStatus}
        isTypingText={isTypingText}
        isSyncing={Boolean(isSyncing?.[activeChat?.id])}
        isInfoOpen={isInfoOpen}
        setIsInfoOpen={setIsInfoOpen}
        setActiveChatId={setActiveChatId}
      />
      {!isOnline && (
        <div className="offline-banner" style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <WifiOff size={14} className="offline-banner-icon" />
          <span>Соединение потеряно. Переподключение...</span>
        </div>
      )}

      {/* Messages Window */}
      <div
        className={`chat-body ${isCustomWallpaper ? 'has-custom-wallpaper' : ''}`}
        ref={chatBodyRef}
        onScroll={handleScroll}
        style={chatBodyStyle}
      >
        {isInitialLoading ? (
          <ChatSkeleton />
        ) : (
          <div className="messages-list">
            {activeChat.messages.map((msg, index) => {
              const prevMsg = activeChat.messages[index - 1];
              const showDateDivider = !prevMsg || (
                new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
              );
              const dateDividerText = showDateDivider ? formatDateDivider(msg.timestamp) : null;
              const firstUnreadIndex = (activeChat.unread_count > 0)
                ? activeChat.messages.length - activeChat.unread_count
                : activeChat.messages.findIndex((m) => m.senderId !== currentUser?.id && m.senderId !== 'current' && !m.read);
              const showUnreadDivider = index === firstUnreadIndex && firstUnreadIndex > 0;

              return (
                <React.Fragment key={msg.id}>
                  {dateDividerText && (
                    <div className="chat-date-divider">
                      <span>{dateDividerText}</span>
                    </div>
                  )}
                  {showUnreadDivider && (
                    <div className="unread-messages-divider" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '14px 0', position: 'relative' }}>
                      <span style={{ background: 'var(--accent-color, #2481cc)', color: '#fff', fontSize: '11px', padding: '3px 12px', borderRadius: '12px', fontWeight: '500', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                        Непрочитанные сообщения
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    msg={msg}
                    index={index}
                    activeChat={activeChat}
                    currentUser={currentUser}
                    renderAvatar={renderAvatar}
                    showMsgActionsId={showMsgActionsId}
                    setShowMsgActionsId={setShowMsgActionsId}
                    retryMenuMsgId={retryMenuMsgId}
                    setRetryMenuMsgId={setRetryMenuMsgId}
                    setReplyingTo={setReplyingTo}
                    setOpenedImageUrl={setOpenedImageUrl}
                    deleteMessage={deleteMessage}
                    toggleReaction={toggleReaction}
                    retrySendMessage={retrySendMessage}
                    deleteFailedMessage={deleteFailedMessage}
                    emojis={emojis}
                  />
                </React.Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating scroll to bottom button */}
      {showScrollBottom && (
        <button
          className="scroll-bottom-btn"
          onClick={() => {
            shouldAutoScrollRef.current = true;
            scrollToBottom('smooth');
          }}
        >
          <ArrowDown size={18} />
        </button>
      )}

      {openedImageUrl && (
        <ImageViewer imageUrl={openedImageUrl} onClose={() => setOpenedImageUrl(null)} />
      )}

      {/* Input Area */}
      {!canPost ? (
        <footer className="chat-footer-input restricted" style={{ padding: '8px 16px' }}>
          <div className="restricted-input-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', color: 'var(--text-secondary)', fontSize: '13px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', width: '100%', textAlign: 'center', boxSizing: 'border-box' }}>
            <span>{activeChat?.requiresUpdate
              ? 'Для этого чата требуется версия Coiny с поддержкой E2EE v2. Отправка заблокирована.'
              : activeChat?.type === 'channel'
                ? 'Только администраторы могут отправлять сообщения в этот канал'
                : 'Только администраторы могут отправлять сообщения в эту группу'}</span>
          </div>
        </footer>
      ) : (
        <footer className="chat-footer-input">
        {recipientMissingE2EE && (
          <div className="e2ee-waiting-banner">
            <Lock size={14} className="e2ee-banner-icon" />
            <span>Ожидание настройки ключей шифрования собеседником...</span>
          </div>
        )}

        {/* Reply Bar Overlay */}
        {replyingTo && (
          <div className="reply-indicator-bar">
            <CornerUpLeft size={16} className="reply-bar-icon" />
            <div className="reply-bar-meta">
              <span className="reply-bar-title">Ответ пользователю {replyingTo.senderName}</span>
              <p className="reply-bar-desc">
                {(() => {
                  const info = getReplyType(replyingTo);
                  if (info.type === 'image') return <><Camera size={13} className="reply-media-svg" /> Фото</>;
                  if (info.type === 'video') return <><Video size={13} className="reply-media-svg" /> Видео</>;
                  if (info.type === 'video_note') return <><Video size={13} className="reply-media-svg" /> Видеосообщение</>;
                  if (info.type === 'voice') return <><Mic size={13} className="reply-media-svg" /> Голосовое сообщение</>;
                  if (info.type === 'sticker') return <><Smile size={13} className="reply-media-svg" /> Стикер</>;
                  return info.text;
                })()}
              </p>
            </div>
            <button className="reply-bar-close" onClick={() => setReplyingTo(null)}>
              <X size={16} />
            </button>
          </div>
        )}

        <div className="input-row">
          {isRecording ? (
            <div className={`recording-panel ${isRecordingLocked ? 'locked' : ''}`}>
              <div className={`record-dot ${isRecordingPaused ? 'paused' : ''}`} />
              {isRecordingLocked && (
                <div className="record-locked-badge">
                  <Lock size={13} />
                </div>
              )}
              <span className="record-timer">{formatDuration(recordDuration)}</span>
              
              {!isRecordingLocked ? (
                <>
                  <div className="record-wave">
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                    <span className="record-wave-bar" />
                  </div>
                  <span className="record-cancel-hint">← Проведите влево для отмены</span>
                </>
              ) : (
                <div className="record-locked-controls">
                  <button 
                    type="button" 
                    className="record-control-btn btn-trash" 
                    onClick={() => stopRecordingAndSend(true)}
                    title="Удалить запись"
                  >
                    <Trash2 size={18} />
                  </button>
                  
                  <button 
                    type="button" 
                    className="record-control-btn btn-pause-resume" 
                    onClick={isRecordingPaused ? resumeRecording : pauseRecording}
                    title={isRecordingPaused ? "Продолжить запись" : "Приостановить запись"}
                  >
                    {isRecordingPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
                  </button>
                  
                  <button 
                    type="button" 
                    className="record-control-btn btn-send" 
                    onClick={() => stopRecordingAndSend(false)}
                    title="Отправить"
                  >
                    <Send size={18} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Attachment button */}
              {canSendMedia && !recipientMissingE2EE && (
                <div className="attach-wrapper">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept={CHAT_MEDIA_ACCEPT}
                    style={{ display: 'none' }}
                    disabled={uploading}
                  />
                  <button
                    type="button"
                    className="input-action-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Прикрепить изображение или файл"
                    disabled={uploading}
                  >
                    {uploading ? (
                      <div className="spinner" style={{ width: '18px', height: '18px', borderColor: 'var(--text-secondary)', borderTopColor: 'var(--accent-color)' }} />
                    ) : (
                      <Paperclip size={22} />
                    )}
                  </button>
                </div>
              )}

              {/* Text Area */}
              <div className="input-textarea-wrapper">
                <textarea
                  ref={textareaRef}
                  placeholder={recipientMissingE2EE ? "Шифрование недоступно..." : "Напишите сообщение..."}
                  value={inputVal}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyPress}
                  onPaste={handlePaste}
                  rows={1}
                  disabled={recipientMissingE2EE}
                />

                {/* Emoji / Sticker / GIF picker */}
                <div className="emoji-wrapper" ref={emojiRef} onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`input-action-btn emoji-trigger ${showEmojiPicker ? 'active' : ''}`}
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    title="Смайлы, стикеры и GIF"
                  >
                    <Smile size={22} />
                  </button>

                  <MediaPickerPanel
                    isOpen={showEmojiPicker}
                    onClose={() => setShowEmojiPicker(false)}
                    onSelectEmoji={handleEmojiClick}
                    onSelectSticker={(stickerTag, fileUrl) => {
                      sendMessage(stickerTag, replyingTo?.id, fileUrl);
                      setReplyingTo(null);
                    }}
                    onSelectGif={(gifUrl) => {
                      sendMessage('', replyingTo?.id, gifUrl);
                      setReplyingTo(null);
                    }}
                    installedStickers={installedStickers}
                    onOpenStickerSettings={() => {
                      setIsSettingsOpen(true);
                      setSettingsTab('stickers');
                    }}
                  />
                </div>
              </div>
            </>
          )}

          {/* Send Action */}
          {inputVal.trim() && !recipientMissingE2EE ? (
            <button
              className="send-message-btn"
              onClick={handleSend}
              title="Отправить"
            >
              <Send size={20} />
            </button>
          ) : canSendMedia && !recipientMissingE2EE ? (
            <div style={{ position: 'relative' }}>
              {isRecording && !isRecordingLocked && (
                <div className={`recording-lock-indicator ${isLockActive ? 'active' : ''}`}>
                  <div className="lock-arrow-up">▲</div>
                  <div className="lock-icon-wrapper">
                    <Lock size={15} />
                  </div>
                </div>
              )}
              <button
                type="button"
                className={`send-message-btn record-message-btn ${isRecording ? 'recording' : ''} ${isRecordingStarting ? 'recording-starting' : ''}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onContextMenu={(event) => event.preventDefault()}
                title={isRecordingStarting
                  ? 'Подготовка записи…'
                  : recordMode === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение'}
                aria-label={isRecordingStarting
                  ? 'Подготовка записи'
                  : recordMode === 'voice' ? 'Голосовое сообщение' : 'Видеосообщение'}
                aria-pressed={isRecording || isRecordingStarting}
                disabled={uploading || isRecordingLocked}
              >
                {recordMode === 'voice' ? <Mic size={20} /> : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                )}
              </button>
            </div>
          ) : (
            <button
              className="send-message-btn"
              disabled
              title={recipientMissingE2EE ? "Ожидание настройки собеседником" : "Отправка медиа ограничена"}
              style={{ opacity: 0.4, cursor: 'not-allowed' }}
            >
              <Send size={20} />
            </button>
          )}
        </div>
      </footer>
      )}

      {/* Video Recording Live Preview Overlay */}
      {isRecording && recordMode === 'video' && (
        <div className={`video-record-preview-overlay ${isRecordingPaused ? 'paused' : ''}`}>
          <div className="video-record-circle">
            <video ref={videoPreviewRef} muted playsInline autoPlay />
            {isRecordingPaused && (
              <div className="video-paused-overlay">
                <Pause size={32} />
              </div>
            )}
          </div>
          <div className="video-record-timer">
            {formatDuration(recordDuration)}
          </div>
          <div className="video-record-hint">
            {isRecordingPaused ? (
              <>Запись приостановлена<br />Нажмите кнопку воспроизведения внизу для продолжения</>
            ) : isRecordingLocked ? (
              <>Запись заблокирована<br />Используйте кнопки управления внизу для паузы или отправки</>
            ) : (
              <>Запись круглого видеосообщения<br />Отпустите кнопку для отправки, проведите влево для отмены, проведите вверх для блокировки</>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
