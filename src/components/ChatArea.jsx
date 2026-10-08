import React, { useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import { useChat } from '../context/ChatContext';
import './ChatArea.css';
import coinyLogo from '../assets/logo.png';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { ArrowDown, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';
import {
  importPublicKey,
  deriveSymmetricKey,
  encryptFileForE2EE,
  requireE2EEKey
} from '../utils/e2eeHelper';
import { extensionForMedia, validateChatMedia } from '../utils/mediaValidation';
import {
  getSupportedRecordingMimeTypes,
  normalizeRecordingMimeType,
} from '../utils/mediaRecording';
import { requiresPersonalE2EE } from '../utils/savedMessages';
import ChatHeader from './chat/ChatHeader';
import ChatComposer from './chat/ChatComposer';
import ChatSearchBar from './chat/ChatSearchBar';
import MessageBubble from './chat/MessageBubble';
import ImageViewer from './chat/ImageViewer';
import { createStorageReference } from '../utils/urlSecurity';
import useResolvedMedia from '../hooks/useResolvedMedia';
import useEdgeSwipeBack from '../hooks/useSwipeGesture';
import ChatSkeleton from './chat/ChatSkeleton';

function findSavedScrollTarget(element, saved) {
  const rows = [...element.querySelectorAll('.message-row[data-message-id]')];
  const exact = rows.find(row => row.dataset.messageId === saved.topMessageId);
  if (exact) return { row: exact, needsOlder: false };
  const timestamp = saved.topMessageTimestamp;
  if (!Number.isFinite(timestamp)) return { row: null, needsOlder: true };
  const closest = rows.find(row => Number(row.dataset.messageTimestamp) >= timestamp) || rows.at(-1);
  const oldest = Number(rows[0]?.dataset.messageTimestamp);
  return { row: closest, needsOlder: !Number.isFinite(oldest) || oldest > timestamp };
}

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
    historyLoadStatus,
    loadActiveChatMessages,
    isSyncing,
    openSettings
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
  const requiresE2EE = requiresPersonalE2EE(activeChat, currentUser?.id);
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
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
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  useEffect(() => {
    setHoveredMessageId(null);
    setShowMsgActionsId(null);
  }, [activeChat?.id]);

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
  const isInitialChatLoadRef = useRef(true);
  const currentChatIdRef = useRef(activeChat?.id);
  const userScrolledManuallyRef = useRef(false);
  const isScrollingToBottomRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const anchorMessageIdRef = useRef(null);
  const anchorOffsetRef = useRef(0);
  const chatScrollPositionsRef = useRef(new Map());
  const paginationRequestRef = useRef(null);
  const [paginationRestoreRevision, setPaginationRestoreRevision] = useState(0);
  const historyRestoreRequestRef = useRef(null);
  const historyRestoreStoppedRef = useRef(false);
  const [historyRestoreRevision, setHistoryRestoreRevision] = useState(0);
  const isPointerDownRef = useRef(false);
  const initialMountTickRef = useRef(true);
  const footerRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const [footerHeight, setFooterHeight] = useState(0);

  const restoreReadingAnchor = useCallback((element) => {
    if (!anchorMessageIdRef.current) return;
    const anchor = element.querySelector(`.message-row[data-message-id="${anchorMessageIdRef.current}"]`);
    if (!anchor) return;
    // offsetTop rounds fractional row positions in WebKit. Restore by the
    // visible delta so repeated resizes cannot accumulate that rounding.
    const delta = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - anchorOffsetRef.current;
    if (Math.abs(delta) > 0.5) element.scrollTop += delta;
    lastScrollTopRef.current = element.scrollTop;
  }, []);

  useEffect(() => () => {
    paginationRequestRef.current = null;
    historyRestoreRequestRef.current = null;
  }, []);

  // In-chat message search
  const matchedMessages = useMemo(() => {
    if (!searchQuery.trim() || !activeChat?.messages) return [];
    const query = searchQuery.trim().toLowerCase();
    return activeChat.messages.filter((m) => {
      if (!m.text) return false;
      return m.text.toLowerCase().includes(query);
    });
  }, [searchQuery, activeChat?.messages]);

  useEffect(() => {
    if (matchedMessages.length === 0) {
      setCurrentMatchIndex(0);
    } else if (currentMatchIndex >= matchedMessages.length) {
      setCurrentMatchIndex(matchedMessages.length - 1);
    }
  }, [matchedMessages.length, currentMatchIndex]);

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
  }, [activeChat?.id]);

  const scrollToMatchedMessage = useCallback((msgId) => {
    if (!msgId || !chatBodyRef.current) return;
    const targetEl = chatBodyRef.current.querySelector(`.message-row[data-message-id="${msgId}"]`);
    if (targetEl) {
      userScrolledManuallyRef.current = true;
      shouldAutoScrollRef.current = false;
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleNextMatch = useCallback(() => {
    if (matchedMessages.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % matchedMessages.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatchedMessage(matchedMessages[nextIdx]?.id);
  }, [matchedMessages, currentMatchIndex, scrollToMatchedMessage]);

  const handlePrevMatch = useCallback(() => {
    if (matchedMessages.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + matchedMessages.length) % matchedMessages.length;
    setCurrentMatchIndex(prevIdx);
    scrollToMatchedMessage(matchedMessages[prevIdx]?.id);
  }, [matchedMessages, currentMatchIndex, scrollToMatchedMessage]);

  const handleSearchChange = useCallback((newQuery) => {
    setSearchQuery(newQuery);
    setCurrentMatchIndex(0);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery('');
        setCurrentMatchIndex(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isSearchOpen && matchedMessages.length > 0 && matchedMessages[currentMatchIndex]) {
      scrollToMatchedMessage(matchedMessages[currentMatchIndex]?.id);
    }
  }, [isSearchOpen, currentMatchIndex, matchedMessages, scrollToMatchedMessage]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        if (activeChat?.id) {
          e.preventDefault();
          setIsSearchOpen(true);
        }
      } else if (e.key === 'Escape' && isSearchOpen) {
        e.preventDefault();
        handleCloseSearch();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeChat?.id, isSearchOpen, handleCloseSearch]);


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

  const persistSettledScroll = useCallback((targetChatId = activeChat?.id) => {
    const element = chatBodyRef.current;
    if (!element || !targetChatId) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    if (scrollHeight <= 0) return;

    const distanceFromBottom = Math.max(0, scrollHeight - scrollTop - clientHeight);
    const isAtBottom = shouldAutoScrollRef.current && (!userScrolledManuallyRef.current || distanceFromBottom <= 15);

    const messageRows = element.querySelectorAll('.message-row[data-message-id]');
    let topMessageId = null;
    let topMessageOffset = 0;
    let topMessageTimestamp = null;
    const containerTop = element.getBoundingClientRect().top;
    for (const row of messageRows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > containerTop + 5) {
        topMessageId = row.getAttribute('data-message-id');
        topMessageOffset = rect.top - containerTop;
        const timestamp = Number(row.dataset.messageTimestamp);
        topMessageTimestamp = Number.isFinite(timestamp) ? timestamp : null;
        break;
      }
    }

    const scrollData = {
      scrollTop,
      scrollHeight,
      distanceFromBottom,
      isAtBottom,
      topMessageId,
      topMessageOffset,
      topMessageTimestamp,
      timestamp: Date.now()
    };

    chatScrollPositionsRef.current.set(targetChatId, scrollData);
    saveChatScroll(targetChatId, scrollData);
  }, [activeChat?.id]);

  const saveCurrentScrollPosition = useCallback(() => {
    if (isInitialChatLoadRef.current) return;
    persistSettledScroll(activeChat?.id);
  }, [activeChat?.id, persistSettledScroll]);

  const attachChatBody = useCallback(element => {
    // Each chat owns its DOM node. Save the outgoing node before React removes
    // it, including a final movement whose scroll event has not fired yet.
    if (!element && chatBodyRef.current && !isInitialChatLoadRef.current) {
      persistSettledScroll(activeChat?.id);
    }
    chatBodyRef.current = element;
  }, [activeChat?.id, persistSettledScroll]);

  // Auto-scroll to bottom on chat switch or new message
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const element = chatBodyRef.current;
    if (!element) return;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    userScrolledManuallyRef.current = false;
    isPointerDownRef.current = false;
    shouldAutoScrollRef.current = true;
    anchorMessageIdRef.current = null;
    anchorOffsetRef.current = 0;
    setShowScrollBottom(false);

    if (behavior === 'auto') {
      isScrollingToBottomRef.current = false;
      element.scrollTop = element.scrollHeight;
    } else {
      isScrollingToBottomRef.current = true;
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
      } else if (messagesEndRef.current?.scrollIntoView) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        element.scrollTop = element.scrollHeight;
      }

      scrollTimeoutRef.current = setTimeout(() => {
        if (isScrollingToBottomRef.current && chatBodyRef.current) {
          chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
          isScrollingToBottomRef.current = false;
          shouldAutoScrollRef.current = true;
          setShowScrollBottom(false);
          persistSettledScroll(activeChat?.id);
        }
      }, 2000);
    }

    if (activeChat?.id) {
      const scrollData = {
        scrollTop: element.scrollHeight,
        scrollHeight: element.scrollHeight,
        distanceFromBottom: 0,
        isAtBottom: true,
        topMessageId: null,
        topMessageOffset: 0,
        timestamp: Date.now()
      };
      chatScrollPositionsRef.current.set(activeChat.id, scrollData);
      saveChatScroll(activeChat.id, scrollData);
    }
  }, [activeChat?.id, persistSettledScroll]);

  useEffect(() => {
    const handleSave = () => {
      saveCurrentScrollPosition();
    };
    const handlePointerRelease = () => {
      isPointerDownRef.current = false;
    };
    window.addEventListener('beforeunload', handleSave);
    window.addEventListener('pagehide', handleSave);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleSave();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleSave);
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('touchend', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    return () => {
      window.removeEventListener('beforeunload', handleSave);
      window.removeEventListener('pagehide', handleSave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleSave);
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('touchend', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [saveCurrentScrollPosition]);

  useLayoutEffect(() => {
    if (currentChatIdRef.current !== activeChat?.id) {
      currentChatIdRef.current = activeChat?.id;
      paginationRequestRef.current = null;
      historyRestoreRequestRef.current = null;
      historyRestoreStoppedRef.current = false;
      isLoadingOlderRef.current = false;
      lastScrollTopRef.current = 0;
      isInitialChatLoadRef.current = true;
      userScrolledManuallyRef.current = false;
      isScrollingToBottomRef.current = false;
      anchorMessageIdRef.current = null;
      anchorOffsetRef.current = 0;
      initialMountTickRef.current = true;
      setShowScrollBottom(false);
    }

    if (isInitialLoading) return;
    const element = chatBodyRef.current;
    if (!element || !activeChat?.id) return;
    const messageCount = activeChat?.messages?.length || 0;
    if (messageCount === 0) return;

    if (!isInitialChatLoadRef.current) {
      // React updates can change rows before an earlier restoration's scroll
      // event is delivered. Restore synchronously so it cannot save a shifted
      // anchor between rapid reaction or history updates.
      if (!shouldAutoScrollRef.current && !isScrollingToBottomRef.current &&
        !isLoadingOlderRef.current && !isPointerDownRef.current && anchorMessageIdRef.current) {
        restoreReadingAnchor(element);
      }
      return;
    }
    if (userScrolledManuallyRef.current) {
      isInitialChatLoadRef.current = false;
      initialMountTickRef.current = false;
      return;
    }

    const saved = chatScrollPositionsRef.current.get(activeChat?.id) || getSavedChatScroll(activeChat?.id);
    shouldAutoScrollRef.current = !saved || saved.isAtBottom;

    // Restore the place the user left before considering new unread messages.
    // The initial cache/server window can omit that message, so retain the
    // saved anchor while older pages are fetched instead of overwriting it.
    if (saved && !saved.isAtBottom && saved.topMessageId) {
      const target = findSavedScrollTarget(element, saved);
      if (target.needsOlder && (
        messageCount <= 1 || isSyncing?.[activeChat.id] || isChatLoading?.[activeChat.id] ||
        messagePagination?.[activeChat.id]?.hasMore !== false
      )) {
        if (typeof saved.scrollTop === 'number') element.scrollTop = saved.scrollTop;
        lastScrollTopRef.current = element.scrollTop;
        return;
      }

      const offset = typeof saved.topMessageOffset === 'number' ? saved.topMessageOffset : 0;
      element.scrollTop = target.row ? target.row.offsetTop - offset : saved.scrollTop || 0;
      lastScrollTopRef.current = element.scrollTop;
      anchorMessageIdRef.current = target.row?.dataset.messageId || null;
      anchorOffsetRef.current = offset;
      userScrolledManuallyRef.current = true;
      isInitialChatLoadRef.current = false;
      initialMountTickRef.current = false;
      persistSettledScroll(activeChat.id);
      setShowScrollBottom(element.scrollHeight - element.scrollTop - element.clientHeight > 300);
      return;
    }

    // With no saved reading anchor, start at the unread divider.
    const unreadCount = typeof activeChat?.unread_count === 'number'
      ? activeChat.unread_count
      : (Array.isArray(activeChat?.messages) ? activeChat.messages : []).filter(
          (m) => m.senderId !== currentUser?.id && m.senderId !== 'current' && !m.read
        ).length;

    if (unreadCount > 0) {
      const unreadEl = element.querySelector('.unread-messages-divider');
      if (unreadEl) {
        unreadEl.scrollIntoView({ block: 'center', behavior: 'auto' });
        shouldAutoScrollRef.current = false;
        const containerTop = element.getBoundingClientRect().top;
        const messageRows = element.querySelectorAll('.message-row[data-message-id]');
        for (const row of messageRows) {
          const rect = row.getBoundingClientRect();
          if (rect.bottom > containerTop + 5) {
            anchorMessageIdRef.current = row.getAttribute('data-message-id');
            anchorOffsetRef.current = rect.top - containerTop;
            break;
          }
        }
        isInitialChatLoadRef.current = false;
        initialMountTickRef.current = false;
        persistSettledScroll(activeChat.id);
        const dist = Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
        setShowScrollBottom(dist > 300);
        return;
      }
      if (messageCount <= 1 || isSyncing?.[activeChat?.id] || isChatLoading?.[activeChat?.id]) {
        return;
      }
    }

    // 3. Saved Bottom OR Default to Bottom
    element.scrollTop = element.scrollHeight;
    shouldAutoScrollRef.current = true;
    anchorMessageIdRef.current = null;
    anchorOffsetRef.current = 0;
    setShowScrollBottom(false);

    if (messageCount > 1 || (!initialMountTickRef.current && !isSyncing?.[activeChat?.id] && !isChatLoading?.[activeChat?.id])) {
      isInitialChatLoadRef.current = false;
      initialMountTickRef.current = false;
      persistSettledScroll(activeChat.id);
    } else {
      initialMountTickRef.current = false;
    }
  }, [activeChat?.id, activeChat?.messages, activeChat?.unread_count, isInitialLoading, isChatLoading, isSyncing, messagePagination, historyRestoreRevision, currentUser?.id, persistSettledScroll, restoreReadingAnchor]);

  useEffect(() => {
    if (!activeChat?.id || !isInitialChatLoadRef.current || userScrolledManuallyRef.current ||
      historyRestoreRequestRef.current || historyRestoreStoppedRef.current ||
      isChatLoading?.[activeChat.id] || isSyncing?.[activeChat.id] ||
      messagePagination?.[activeChat.id]?.loading ||
      activeChat.messages.length <= 1 || messagePagination?.[activeChat.id]?.hasMore === false) return;
    const saved = chatScrollPositionsRef.current.get(activeChat.id) || getSavedChatScroll(activeChat.id);
    if (!saved || saved.isAtBottom || !saved.topMessageId || !chatBodyRef.current ||
      !findSavedScrollTarget(chatBodyRef.current, saved).needsOlder) return;

    const request = { chatId: activeChat.id };
    historyRestoreRequestRef.current = request;
    Promise.resolve().then(() => historyRestoreRequestRef.current === request
      ? loadOlderMessages(request.chatId) : 0).then(loaded => {
      if (historyRestoreRequestRef.current !== request) return;
      // A failed/offline page must not erase the original saved position or
      // retry indefinitely. A new visit can try again; manual scrolling wins.
      if (!loaded) historyRestoreStoppedRef.current = true;
    }).catch(() => {
      if (historyRestoreRequestRef.current === request) historyRestoreStoppedRef.current = true;
    }).finally(() => {
      if (historyRestoreRequestRef.current !== request) return;
      historyRestoreRequestRef.current = null;
      setHistoryRestoreRevision(revision => revision + 1);
    });
  }, [activeChat?.id, activeChat?.messages, isChatLoading, isSyncing, messagePagination, loadOlderMessages, historyRestoreRevision]);

  useLayoutEffect(() => {
    const request = paginationRequestRef.current;
    if (!request?.restorationPending || currentChatIdRef.current !== request.chatId ||
      chatBodyRef.current !== request.element) return;
    // The state update and this layout effect commit together. An animation
    // frame after the promise can run before React has inserted the new rows.
    const { element, previousTop, previousHeight, readingAnchorId, readingAnchorOffset } = request;
    const readingAnchor = readingAnchorId
      ? [...element.querySelectorAll('.message-row')].find(row => row.dataset.messageId === readingAnchorId)
      : null;
    if (shouldAutoScrollRef.current) {
      element.scrollTop = element.scrollHeight;
    } else if (readingAnchor) {
      element.scrollTop = readingAnchor.offsetTop - readingAnchorOffset;
      anchorMessageIdRef.current = readingAnchorId;
      anchorOffsetRef.current = readingAnchorOffset;
    } else {
      chatBodyRef.current.scrollTop = previousTop + chatBodyRef.current.scrollHeight - previousHeight;
    }
    lastScrollTopRef.current = element.scrollTop;
    persistSettledScroll(request.chatId);
    paginationRequestRef.current = null;
    isLoadingOlderRef.current = false;
  }, [activeChat?.messages, paginationRestoreRevision, persistSettledScroll]);

  useEffect(() => {
    const element = chatBodyRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    // Loading replaces the list with a skeleton, so observe its new node when
    // cached or server messages arrive instead of retaining a detached list.
    const listElement = element.querySelector('.messages-list') || element;

    const observer = new ResizeObserver(() => {
      if (!chatBodyRef.current || isInitialChatLoadRef.current || isLoadingOlderRef.current || isPointerDownRef.current) return;
      if (isScrollingToBottomRef.current) {
        if (typeof chatBodyRef.current.scrollTo === 'function') {
          chatBodyRef.current.scrollTo({ top: chatBodyRef.current.scrollHeight, behavior: 'smooth' });
        }
      } else if (shouldAutoScrollRef.current) {
        // Keep the existing bottom pin when media or the composer changes size.
        // The distance after resizing no longer describes the user's intent.
        chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
        lastScrollTopRef.current = chatBodyRef.current.scrollTop;
      } else if (anchorMessageIdRef.current) {
        restoreReadingAnchor(chatBodyRef.current);
      }
    });

    observer.observe(listElement);
    if (listElement !== element) observer.observe(element);
    return () => observer.disconnect();
  }, [activeChat?.id, isInitialLoading, restoreReadingAnchor]);

  useEffect(() => {
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
  }, [activeChat?.id, isInitialLoading]);

  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const updateHeight = () => {
      if (footerRef.current) {
        setFooterHeight(footerRef.current.offsetHeight);
      }
    };
    updateHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [replyingTo, canPost]);

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
  const prevChatIdRef = useRef(activeChat?.id);

  useEffect(() => {
    const isChatChanged = prevChatIdRef.current !== activeChat?.id;
    prevChatIdRef.current = activeChat?.id;

    if (isChatChanged) {
      prevMessageCountRef.current = messageCount;
      prevLatestMessageIdRef.current = latestMessageId;
      return;
    }

    const isNewMessage = (
      messageCount > prevMessageCountRef.current &&
      latestMessageId !== prevLatestMessageIdRef.current
    );
    const isOwnMessage = isNewMessage && (latestMessageSenderId === currentUser?.id || latestMessageSenderId === 'current');

    const isHydratingChatHistory = Boolean(
      isInitialChatLoadRef.current ||
      isChatLoading?.[activeChat?.id] ||
      (prevMessageCountRef.current <= 1 && messageCount > 1)
    );

    if (!isLoadingOlderRef.current && !isHydratingChatHistory && isNewMessage) {
      if (shouldAutoScrollRef.current || isOwnMessage) {
        // Own sends jump instantly so smooth-scroll cannot be interrupted by
        // pagination/layout while the row is still off-screen.
        scrollToBottom(isOwnMessage ? 'auto' : 'smooth');
      }
    }

    prevMessageCountRef.current = messageCount;
    prevLatestMessageIdRef.current = latestMessageId;
  }, [activeChat?.id, latestMessageId, latestMessageSenderId, messageCount, currentUser?.id, scrollToBottom, isChatLoading]);

  // Monitor the reading position and page backwards near the top.
  const handleScroll = async () => {
    const element = chatBodyRef.current;
    if (!element) return;
    const { scrollTop, scrollHeight, clientHeight } = element;
    const pendingPage = paginationRequestRef.current;
    if (isLoadingOlderRef.current && pendingPage?.element === element &&
      element.querySelector('.message-row')?.dataset.messageId !== pendingPage.firstMessageId) return;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const effectiveDistance = Math.max(0, distanceFromBottom);
    // Browser anchoring can emit scroll events during image decoding. Only
    // user input should release an existing bottom pin in that case.
    const wasPinnedToBottom = shouldAutoScrollRef.current && !userScrolledManuallyRef.current && !isPointerDownRef.current;
    const isScrollingUp = scrollTop < (lastScrollTopRef.current || 0);
    const isScrollingDown = scrollTop > (lastScrollTopRef.current || 0);
    lastScrollTopRef.current = scrollTop;

    if (isScrollingUp && isScrollingToBottomRef.current) {
      isScrollingToBottomRef.current = false;
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      userScrolledManuallyRef.current = true;
      shouldAutoScrollRef.current = false;
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top: element.scrollTop, behavior: 'auto' });
      }
    }

    if (isScrollingToBottomRef.current) {
      if (effectiveDistance <= 30) {
        isScrollingToBottomRef.current = false;
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = null;
        }
        shouldAutoScrollRef.current = true;
        setShowScrollBottom(false);
        persistSettledScroll(activeChat?.id);
      } else {
        shouldAutoScrollRef.current = true;
        setShowScrollBottom(false);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        scrollTimeoutRef.current = setTimeout(() => {
          if (isScrollingToBottomRef.current && chatBodyRef.current) {
            chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
            isScrollingToBottomRef.current = false;
            shouldAutoScrollRef.current = true;
            setShowScrollBottom(false);
            persistSettledScroll(activeChat?.id);
          }
        }, 300);
      }
      return;
    }

    shouldAutoScrollRef.current = wasPinnedToBottom || distanceFromBottom < 120;
    setShowScrollBottom(!wasPinnedToBottom && distanceFromBottom > 300);

    if (userScrolledManuallyRef.current || (isScrollingUp && !wasPinnedToBottom)) {
      isInitialChatLoadRef.current = false;
      // Repeated scroll events may have zero delta while a gesture is in progress.
      // Keep reading intent even when its first frame is only a few pixels up.
      if (isScrollingUp || effectiveDistance > 0) {
        shouldAutoScrollRef.current = false;
      }
    }

    if (effectiveDistance <= 15 && !isScrollingUp && (isScrollingDown || !userScrolledManuallyRef.current)) {
      userScrolledManuallyRef.current = false;
      shouldAutoScrollRef.current = true;
      setShowScrollBottom(false);
    }

    if (!isInitialChatLoadRef.current) {
      const containerTop = element.getBoundingClientRect().top;
      const messageRows = element.querySelectorAll('.message-row[data-message-id]');
      let topId = null;
      let topOffset = 0;
      for (const row of messageRows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > containerTop + 5) {
          topId = row.getAttribute('data-message-id');
          topOffset = rect.top - containerTop;
          break;
        }
      }
      anchorMessageIdRef.current = topId;
      anchorOffsetRef.current = topOffset;

      saveCurrentScrollPosition();
    }

    const page = messagePagination?.[activeChat?.id];
    // Opening a long chat starts at scrollTop 0 until layout restores the
    // bottom/anchor. Paging here would prepend history and leave the view
    // stuck in old messages (breaks live E2E read receipts).
    if (isInitialChatLoadRef.current) return;
    if (scrollTop > 80 || page?.hasMore === false || isLoadingOlderRef.current) return;

    isLoadingOlderRef.current = true;
    const request = {
      chatId: activeChat.id, element, previousHeight: scrollHeight, previousTop: scrollTop,
      firstMessageId: element.querySelector('.message-row')?.dataset.messageId,
    };
    paginationRequestRef.current = request;
    let restorationScheduled = false;
    try {
      const loaded = await loadOlderMessages(activeChat.id);
      if (loaded > 0 && paginationRequestRef.current === request) {
        request.readingAnchorId = anchorMessageIdRef.current;
        request.readingAnchorOffset = anchorOffsetRef.current;
        request.restorationPending = true;
        restorationScheduled = true;
        setPaginationRestoreRevision(revision => revision + 1);
      }
    } finally {
      if (!restorationScheduled && paginationRequestRef.current === request) {
        paginationRequestRef.current = null;
        isLoadingOlderRef.current = false;
      }
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
        isSearchOpen={isSearchOpen}
        onToggleSearch={handleToggleSearch}
      />
      {isSearchOpen && (
        <ChatSearchBar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          totalMatches={matchedMessages.length}
          currentMatchIndex={currentMatchIndex}
          onPrevMatch={handlePrevMatch}
          onNextMatch={handleNextMatch}
          onClose={handleCloseSearch}
        />
      )}
      {!isOnline && (
        <div className="offline-banner" style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <WifiOff size={14} className="offline-banner-icon" />
          <span>Соединение потеряно. Переподключение...</span>
        </div>
      )}

      {/* Messages Window */}
      <div
        key={activeChat.id}
        className={`chat-body ${isCustomWallpaper ? 'has-custom-wallpaper' : ''}`}
        ref={attachChatBody}
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
          userScrolledManuallyRef.current = true;
          lastScrollTopRef.current = event.currentTarget.scrollTop;
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
            shouldAutoScrollRef.current = false;
          }
          isScrollingToBottomRef.current = false;
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = null;
          }
        }}
        onWheel={(e) => {
          userScrolledManuallyRef.current = true;
          lastScrollTopRef.current = e.currentTarget.scrollTop;
          isScrollingToBottomRef.current = false;
          if (e.deltaY < 0) {
            shouldAutoScrollRef.current = false;
            if (typeof chatBodyRef.current?.scrollTo === 'function') {
              chatBodyRef.current.scrollTo({ top: chatBodyRef.current.scrollTop, behavior: 'auto' });
            }
          }
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = null;
          }
        }}
        onTouchStart={() => {
          userScrolledManuallyRef.current = true;
          lastScrollTopRef.current = chatBodyRef.current?.scrollTop || 0;
          isScrollingToBottomRef.current = false;
          if (typeof chatBodyRef.current?.scrollTo === 'function') {
            chatBodyRef.current.scrollTo({ top: chatBodyRef.current.scrollTop, behavior: 'auto' });
          }
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = null;
          }
          isPointerDownRef.current = true;
        }}
        onTouchEnd={() => { isPointerDownRef.current = false; }}
        onPointerDown={() => {
          userScrolledManuallyRef.current = true;
          lastScrollTopRef.current = chatBodyRef.current?.scrollTop || 0;
          isScrollingToBottomRef.current = false;
          if (typeof chatBodyRef.current?.scrollTo === 'function') {
            chatBodyRef.current.scrollTo({ top: chatBodyRef.current.scrollTop, behavior: 'auto' });
          }
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = null;
          }
          isPointerDownRef.current = true;
        }}
        onPointerUp={() => { isPointerDownRef.current = false; }}
        onPointerCancel={() => { isPointerDownRef.current = false; }}
        style={chatBodyStyle}
      >
        {isInitialLoading ? (
          <ChatSkeleton />
        ) : (
          <div className="messages-list">
            {historyLoadStatus?.[activeChat.id] === 'error' && (
              <div className="chat-history-notice" role="alert">
                <span>Не удалось загрузить сообщения</span>
                <button type="button" onClick={() => loadActiveChatMessages(activeChat.id)}>Повторить</button>
              </div>
            )}
            {chatMessagesCount === 0 && historyLoadStatus?.[activeChat.id] === 'loaded' && (
              <div className="chat-history-empty" role="status">Здесь пока нет сообщений</div>
            )}
            {activeChat.messages.map((msg, index) => {
              const prevMsg = activeChat.messages[index - 1];
              const showDateDivider = !prevMsg || (
                new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
              );
              const dateDividerText = showDateDivider ? formatDateDivider(msg.timestamp) : null;
              const firstUnreadIndex = (activeChat.unread_count > 0)
                ? activeChat.messages.length - activeChat.unread_count
                : activeChat.messages.findIndex((m) => m.senderId !== currentUser?.id && m.senderId !== 'current' && !m.read);
              const showUnreadDivider = index === firstUnreadIndex && firstUnreadIndex >= 0;

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
                    hoveredMessageId={hoveredMessageId}
                    setHoveredMessageId={setHoveredMessageId}
                    retryMenuMsgId={retryMenuMsgId}
                    setRetryMenuMsgId={setRetryMenuMsgId}
                    setReplyingTo={setReplyingTo}
                    setOpenedImageUrl={setOpenedImageUrl}
                    deleteMessage={deleteMessage}
                    toggleReaction={toggleReaction}
                    retrySendMessage={retrySendMessage}
                    deleteFailedMessage={deleteFailedMessage}
                    emojis={emojis}
                    searchQuery={searchQuery}
                    isSearchMatchTarget={isSearchOpen && matchedMessages[currentMatchIndex]?.id === msg.id}
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
          type="button"
          className="scroll-bottom-btn"
          aria-label="Прокрутить вниз"
          style={footerHeight > 0 ? { bottom: `${footerHeight + 12}px` } : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={() => {
            shouldAutoScrollRef.current = true;
            setShowScrollBottom(false);
            scrollToBottom('smooth');
          }}
        >
          <ArrowDown size={18} />
        </button>
      )}

      {openedImageUrl && (
        <ImageViewer imageUrl={openedImageUrl} onClose={() => setOpenedImageUrl(null)} />
      )}

      <ChatComposer {...{
        activeChat,
        canPost,
        canSendMedia,
        recipientMissingE2EE,
        replyingTo,
        setReplyingTo,
        inputVal,
        handleInputChange,
        handleKeyPress,
        handlePaste,
        handleSend,
        handleEmojiClick,
        showEmojiPicker,
        setShowEmojiPicker,
        emojiRef,
        installedStickers,
        sendMessage,
        fileInputRef,
        handleFileChange,
        uploading,
        isRecording,
        isRecordingStarting,
        isRecordingLocked,
        isRecordingPaused,
        isLockActive,
        recordMode,
        recordDuration,
        formatDuration,
        stopRecordingAndSend,
        pauseRecording,
        resumeRecording,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
        videoPreviewRef,
        footerRef,
        textareaRef,
        openSettings
      }} />
    </main>
  );
}
