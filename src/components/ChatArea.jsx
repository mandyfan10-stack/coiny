import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import './ChatArea.css';
import { ArrowDown, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';
import { requiresPersonalE2EE } from '../utils/savedMessages';
import ChatHeader from './chat/ChatHeader';
import ChatComposer from './chat/ChatComposer';
import ChatSearchBar from './chat/ChatSearchBar';
import ChatEmptyState from './chat/ChatEmptyState';
import MessageList from './chat/MessageList';
import MessageSelectionBar from './chat/MessageSelectionBar';
import ImageViewer from './chat/ImageViewer';
import ForwardMessageDialog from './chat/ForwardMessageDialog';
import { canEditMessage } from '../utils/messageContent.ts';
import './chat/MessageOperations.css';
import useResolvedMedia from '../hooks/useResolvedMedia';
import useEdgeSwipeBack from '../hooks/useSwipeGesture';
import ChatSkeleton from './chat/ChatSkeleton';
import useChatScroll from './chat/useChatScroll';
import useChatSearch from './chat/useChatSearch';
import useChatMediaUpload from './chat/useChatMediaUpload';
import useMediaRecorder from './chat/useMediaRecorder';
import useChatSwipeBack from './chat/useChatSwipeBack';
import {
  formatRecordDuration,
  formatTypingText,
  getChatBodyStyle,
  getChatPermissions,
  isCustomWallpaper as isCustomWallpaperValue,
  shouldCloseMessageActions,
  shouldCloseRetryMenu,
} from './chat/chatAreaModel.ts';

const QUICK_REACTION_EMOJIS = ['😀', '😂', '😍', '👍', '🔥', '🎉', '👏', '❤️', '🤔', '👀', '✨', '🚀', '💯', '😎'];
const TYPING_IDLE_MS = 3000;

export default function ChatArea() {
  const {
    activeChat,
    getChatStatus,
    sendMessage,
    editMessage,
    drafts: storedDrafts,
    updateDraft,
    draftError,
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

  const { canPost, canSendMedia } = getChatPermissions(activeChat, currentUser?.id);

  useEdgeSwipeBack({
    onSwipeBack: () => {
      if (forwarding) { document.querySelector('.forward-dialog button[aria-label="Закрыть пересылку"]')?.click(); return; }
      if (editingMessage) { setEditingMessage(null); return; }
      if (selection !== null) { setSelection(null); return; }
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

  const isCustomWallpaper = isCustomWallpaperValue(wallpaper);
  // Wallpaper is per-user, not per-chat: no chat id, so switching chats never re-fetches it.
  const { url: resolvedWallpaper } = useResolvedMedia(
    isCustomWallpaper ? wallpaper : null,
    null,
    'image/webp'
  );
  const chatBodyStyle = getChatBodyStyle(wallpaper, resolvedWallpaper);

  // ---- Composer draft & editing
  const [localDrafts, setLocalDrafts] = useState({});
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');
  const [operationError, setOperationError] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, []);

  // ---- Selection & forwarding
  const [selection, setSelection] = useState(null);
  const selectionCancelRef = useRef(null);
  const isSelecting = selection !== null;
  const [forwarding, setForwarding] = useState(null);
  const closeForwarding = useCallback(() => { setForwarding(null); setSelection(null); focusComposer(); }, [focusComposer]);

  const draftOwner = `${currentUser?.id}:${activeChat?.id}`;
  const draft = (storedDrafts || localDrafts)[activeChat?.id] || { text: '', replyTo: null };
  const draftRef = useRef({ owner: draftOwner, value: draft });
  if (draftRef.current.owner !== draftOwner || draftRef.current.value !== draft) draftRef.current = { owner: draftOwner, value: draft };
  const writeDraft = (value) => {
    draftRef.current.value = value;
    if (updateDraft) updateDraft(activeChat.id, value);
    else setLocalDrafts(previous => ({ ...previous, [activeChat.id]: value }));
  };
  const inputVal = editingMessage ? editText : draft.text;
  const replyingTo = draft.replyTo;
  const setInputVal = value => {
    const next = typeof value === 'function' ? value(inputVal) : value;
    if (editingMessage) setEditText(next);
    else writeDraft({ ...draftRef.current.value, text: next });
  };
  const setReplyingTo = value => {
    if (sending && editingMessage) return;
    if (value) setEditingMessage(null);
    writeDraft({ ...draftRef.current.value, replyTo: value });
  };
  const operationScope = useRef(draftOwner);
  operationScope.current = draftOwner;

  // ---- Menus & overlays
  const [retryMenuMsgId, setRetryMenuMsgId] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMsgActionsId, setShowMsgActionsId] = useState(null);
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const [openedImageUrl, setOpenedImageUrl] = useState(null);
  const emojiRef = useRef(null);
  const fileInputRef = useRef(null);
  const footerRef = useRef(null);
  const [footerHeight, setFooterHeight] = useState(0);

  // ---- Typing indicator
  const [isCurrentlyTyping, setIsCurrentlyTyping] = useState(false);
  const isCurrentlyTypingRef = useRef(isCurrentlyTyping);
  isCurrentlyTypingRef.current = isCurrentlyTyping;
  const sendTypingStatusRef = useRef(sendTypingStatus);
  sendTypingStatusRef.current = sendTypingStatus;
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    if (!isSelecting) return;
    setShowMsgActionsId(null);
    setHoveredMessageId(null);
    setRetryMenuMsgId(null);
    selectionCancelRef.current?.focus({ preventScroll: true });
  }, [isSelecting]);
  useEffect(() => {
    if (!isSelecting || forwarding) return;
    const cancel = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setSelection(null);
      textareaRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', cancel, true);
    return () => document.removeEventListener('keydown', cancel, true);
  }, [isSelecting, forwarding]);
  useEffect(() => {
    setHoveredMessageId(null);
    setShowMsgActionsId(null);
  }, [activeChat?.id]);

  const scroll = useChatScroll({
    activeChat,
    currentUserId: currentUser?.id,
    isInitialLoading,
    isChatLoading,
    isSyncing,
    messagePagination,
    loadOlderMessages,
  });

  const search = useChatSearch({ activeChat, scrollToMessage: scroll.scrollMessageIntoView });

  const { uploading, uploadAndSendRecord, handleFileChange, handlePaste } = useChatMediaUpload({
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
    isBlocked: Boolean(editingMessage || sending),
    fileInputRef,
  });

  const recorder = useMediaRecorder({ uploading, onRecorded: uploadAndSendRecord });
  const { cancelRecording } = recorder;

  // Leaving a chat (or account) abandons in-progress composer work.
  useEffect(() => {
    setEditingMessage(null);
    setSending(false);
    setOperationError('');
    setSelection(null);
    setForwarding(null);
    setOpenedImageUrl(null);

    if (isCurrentlyTypingRef.current) {
      setIsCurrentlyTyping(false);
      sendTypingStatusRef.current(activeChat?.id, false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    cancelRecording();
  }, [activeChat?.id, currentUser?.id, cancelRecording]);

  // The scroll-to-bottom button floats above the composer, whose height varies.
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
    if (!openedImageUrl) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpenedImageUrl(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openedImageUrl]);

  // Close menus when clicking outside them.
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
      if (shouldCloseMessageActions(e.target)) setShowMsgActionsId(null);
      if (shouldCloseRetryMenu(e.target)) setRetryMenuMsgId(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, []);

  const { paneRef, swipeHandlers } = useChatSwipeBack(() => setActiveChatId(null));

  if (!activeChat) return <ChatEmptyState />;

  const beginEdit = message => {
    if (sending || !canEditMessage(message, currentUser?.id) || !editMessage) return;
    cancelRecording();
    setShowMsgActionsId(null); setEditingMessage(message); setEditText(message.text || ''); setOperationError('');
    focusComposer();
  };
  const cancelEdit = () => { setEditingMessage(null); setOperationError(''); };
  const beginForward = message => { setShowMsgActionsId(null); setForwarding([message]); };
  const toggleSelection = message => setSelection(previous => {
    const next = new Set(previous || []);
    if (next.has(message.id)) next.delete(message.id); else next.add(message.id);
    return next;
  });
  const cancelSelection = () => { setSelection(null); textareaRef.current?.focus({ preventScroll: true }); };

  const stopTyping = () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setIsCurrentlyTyping(false);
    sendTypingStatus(activeChat.id, false);
  };

  const handleSend = async () => {
    if (!inputVal.trim() || sending || !canPost) return;
    const scope = draftOwner;
    const submitted = inputVal;
    const submittedReply = replyingTo;
    setSending(true); setOperationError('');
    try {
      if (editingMessage) {
        if (submitted !== editingMessage.text) await editMessage(activeChat.id, editingMessage, submitted);
        if (operationScope.current === scope) { setEditingMessage(null); setEditText(''); }
      } else {
        const result = await sendMessage(submitted, submittedReply?.id);
        if (result === false) throw new Error('Не удалось отправить сообщение. Текст сохранён в черновике.');
        if (operationScope.current === scope) {
          // Keep anything typed while the send was in flight.
          const latest = draftRef.current.value;
          writeDraft({ text: latest.text === submitted ? '' : latest.text,
            replyTo: latest.replyTo?.id === submittedReply?.id ? null : latest.replyTo });
        }
      }
    } catch (error) { if (operationScope.current === scope) setOperationError(error.message || 'Не удалось сохранить сообщение.'); }
    finally { if (operationScope.current === scope) setSending(false); }
    if (operationScope.current !== scope) return;
    stopTyping();
  };

  const handleKeyPress = (e) => {
    if (e.nativeEvent.isComposing || e.isComposing) return;
    if (sending) return;
    if (e.key === 'Escape' && editingMessage) { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
    if (e.key === 'ArrowUp' && !inputVal && !editingMessage) {
      const message = [...activeChat.messages].reverse().find(item => canEditMessage(item, currentUser?.id));
      if (message) { e.preventDefault(); beginEdit(message); }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
    }, TYPING_IDLE_MS);
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
  const isTypingText = formatTypingText(typingUsersInChat);

  return (
    <main className="chat-area" ref={paneRef} {...swipeHandlers}>
      {isSelecting ? (
        <MessageSelectionBar
          count={selection.size}
          cancelRef={selectionCancelRef}
          onCancel={cancelSelection}
          onForward={() => setForwarding(activeChat.messages.filter(message => selection.has(message.id)))}
        />
      ) : <ChatHeader
        activeChat={activeChat}
        renderAvatar={renderAvatar}
        getChatStatus={getChatStatus}
        isTypingText={isTypingText}
        isSyncing={Boolean(isSyncing?.[activeChat?.id])}
        isInfoOpen={isInfoOpen}
        setIsInfoOpen={setIsInfoOpen}
        setActiveChatId={setActiveChatId}
        isSearchOpen={search.isSearchOpen}
        onToggleSearch={search.handleToggleSearch}
      />}
      {search.isSearchOpen && (
        <ChatSearchBar
          searchQuery={search.searchQuery}
          onSearchChange={search.handleSearchChange}
          totalMatches={search.matchCount}
          currentMatchIndex={search.currentMatchIndex}
          onPrevMatch={search.handlePrevMatch}
          onNextMatch={search.handleNextMatch}
          onClose={search.handleCloseSearch}
        />
      )}
      {!isOnline && (
        <div className="offline-banner" style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <WifiOff size={14} className="offline-banner-icon" />
          <span>Соединение потеряно. Переподключение...</span>
        </div>
      )}

      {forwarding && <ForwardMessageDialog sourceChat={activeChat} messages={forwarding} currentUser={currentUser} onClose={closeForwarding}/>}
      <div
        key={activeChat.id}
        className={`chat-body ${isCustomWallpaper ? 'has-custom-wallpaper' : ''}`}
        ref={scroll.attachChatBody}
        tabIndex={0}
        {...scroll.bodyHandlers}
        style={chatBodyStyle}
      >
        {isInitialLoading ? (
          <ChatSkeleton />
        ) : (
          <MessageList
            activeChat={activeChat}
            currentUser={currentUser}
            historyStatus={historyLoadStatus?.[activeChat.id]}
            onRetryHistory={() => loadActiveChatMessages(activeChat.id)}
            messagesEndRef={scroll.messagesEndRef}
            isSelected={id => selection?.has(id) || false}
            currentMatchId={search.currentMatchId}
            bubbleProps={{
              renderAvatar,
              showMsgActionsId,
              setShowMsgActionsId,
              hoveredMessageId,
              setHoveredMessageId,
              retryMenuMsgId,
              setRetryMenuMsgId,
              setReplyingTo,
              onEdit: canPost ? beginEdit : undefined,
              onForward: beginForward,
              onSelect: toggleSelection,
              selectionMode: isSelecting,
              setOpenedImageUrl,
              deleteMessage,
              toggleReaction,
              retrySendMessage,
              deleteFailedMessage,
              emojis: QUICK_REACTION_EMOJIS,
              searchQuery: search.searchQuery,
            }}
          />
        )}
      </div>

      {scroll.showScrollBottom && (
        <button
          type="button"
          className="scroll-bottom-btn"
          aria-label="Прокрутить вниз"
          style={footerHeight > 0 ? { bottom: `${footerHeight + 12}px` } : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={scroll.jumpToBottom}
        >
          <ArrowDown size={18} />
        </button>
      )}

      {openedImageUrl && (
        <ImageViewer imageUrl={openedImageUrl} onClose={() => setOpenedImageUrl(null)} />
      )}

      {(operationError || draftError) && <p role="alert" className="message-operation-error">{operationError || draftError}</p>}
      <ChatComposer {...{
        editingMessage,
        sending,
        onCancelEdit: cancelEdit,
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
        isRecording: recorder.isRecording,
        isRecordingStarting: recorder.isRecordingStarting,
        isRecordingLocked: recorder.isRecordingLocked,
        isRecordingPaused: recorder.isRecordingPaused,
        isLockActive: recorder.isLockActive,
        recordMode: recorder.recordMode,
        recordDuration: recorder.recordDuration,
        formatDuration: formatRecordDuration,
        stopRecordingAndSend: recorder.stopRecordingAndSend,
        pauseRecording: recorder.pauseRecording,
        resumeRecording: recorder.resumeRecording,
        handlePointerDown: recorder.handlePointerDown,
        handlePointerMove: recorder.handlePointerMove,
        handlePointerUp: recorder.handlePointerUp,
        handlePointerCancel: recorder.handlePointerCancel,
        videoPreviewRef: recorder.videoPreviewRef,
        footerRef,
        textareaRef,
        openSettings
      }} />
    </main>
  );
}
