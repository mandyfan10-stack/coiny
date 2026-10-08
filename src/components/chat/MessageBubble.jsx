import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CornerUpLeft,
  Trash2,
  Smile,
  Lock,
  AlertCircle,
  Camera,
  Video,
  Mic
} from 'lucide-react';
import { normalizeReaction } from '../../utils/reactionUtils';
import { SingleCheck, DoubleCheck, PendingClock } from './messageStatusIcons';
import { renderMessageTextWithLinks } from './renderMessageText';
import { personAvatarFallback } from '../../context/chat/avatarFallback';
import { useChat } from '../../context/ChatContext';
import {
  DecryptedImage,
  DecryptedVideoPlayer,
  DecryptedRegularVideoPlayer,
  DecryptedVoicePlayer,
  DecryptedSticker
} from './mediaPlayers';
import MobileActionSheet from './MobileActionSheet';
import useMessageTouch from '../../hooks/useMessageTouch';
import { getMessageGrouping } from '../../utils/messageGrouping';
import { getReplyType } from '../../utils/mobileActionSheetUtils';
import './Message.css';


const SENDER_COLOR_COUNT = 8;

function getSenderColor(idOrName) {
  if (!idOrName) return 'var(--accent-color)';
  let hash = 0;
  for (let i = 0; i < idOrName.length; i++) {
    hash = (hash * 31 + idOrName.charCodeAt(i)) >>> 0;
  }
  return `var(--sender-color-${hash % SENDER_COLOR_COUNT})`;
}

function getFormatTime(dateObj) {
  const d = new Date(dateObj);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({
  msg,
  index,
  activeChat,
  currentUser,
  renderAvatar,
  showMsgActionsId,
  setShowMsgActionsId,
  hoveredMessageId,
  setHoveredMessageId,
  retryMenuMsgId,
  setRetryMenuMsgId,
  setReplyingTo,
  setOpenedImageUrl,
  deleteMessage,
  toggleReaction,
  retrySendMessage,
  deleteFailedMessage,
  emojis,
  searchQuery = '',
  isSearchMatchTarget = false
}) {
  const isMe = msg.senderId === currentUser?.id || msg.senderId === 'current';
  const isGroupOther = activeChat?.type === 'group' && !isMe;
  const replyMsg = msg.replyTo ? activeChat.messages.find(m => m.id === msg.replyTo) : null;

  const nextMsg = activeChat.messages[index + 1];
  const prevMsg = activeChat.messages[index - 1];

  const { isFirstInGroup, isLastInGroup } = getMessageGrouping(msg, prevMsg, nextMsg);
  const showSenderName = isGroupOther && isFirstInGroup;

  const isVoice = Boolean(msg.media && msg.text && (msg.text.startsWith('🎤 Голосовое сообщение') || msg.text.startsWith('Голосовое сообщение')));
  const isVideoNote = Boolean(msg.media && msg.text && (msg.text.startsWith('🎬 Видеосообщение') || msg.text.startsWith('Видеосообщение')));
  const isSticker = Boolean(msg.media && msg.text && msg.text.startsWith('sticker:'));

  const isRegularVideo = Boolean(
    msg.media &&
    !isVoice &&
    !isVideoNote &&
    !isSticker &&
    (msg.text?.startsWith('🎬 [Видео]') || msg.text?.startsWith('[Видео]') || msg.text === 'Видео' || (typeof msg.media === 'string' && (msg.media.includes('.mp4') || msg.media.includes('.webm') || msg.media.includes('.mov') || msg.media.startsWith('data:video/'))))
  );

  const isPureVideo = Boolean(
    isRegularVideo &&
    (!msg.text || msg.text === '🎬 [Видео]' || msg.text === '[Видео]' || msg.text === 'Видео')
  );
  const isVideoWithCaption = Boolean(
    isRegularVideo &&
    !isPureVideo
  );

  const isPureImage = Boolean(
    msg.media &&
    !isVoice &&
    !isVideoNote &&
    !isRegularVideo &&
    !isSticker &&
    (!msg.text || msg.text === '🖼️ [Изображение]' || msg.text === 'Изображение')
  );
  const isImageWithCaption = Boolean(
    msg.media &&
    !isVoice &&
    !isVideoNote &&
    !isRegularVideo &&
    !isSticker &&
    msg.text &&
    msg.text !== '🖼️ [Изображение]' &&
    msg.text !== 'Изображение'
  );

  const senderMember = activeChat?.members?.find(m => m.id === msg.senderId || m.id === msg.sender_id);
  const senderDisplayName = msg.senderName || senderMember?.name || senderMember?.display_name || 'Участник';
  const senderAvatar = senderMember?.avatar || msg.senderAvatar || '👤';

  const { openUserProfile } = useChat();

  const handleSenderClick = useCallback((e) => {
    e.stopPropagation();
    if (!openUserProfile) return;
    const targetUser = senderMember || {
      id: msg.senderId || msg.sender_id,
      name: senderDisplayName,
      username: '',
      avatar: senderAvatar
    };
    if (targetUser.id && targetUser.id !== currentUser?.id && targetUser.id !== 'current') {
      openUserProfile(targetUser);
    }
  }, [openUserProfile, senderMember, msg.senderId, msg.sender_id, senderDisplayName, senderAvatar, currentUser?.id]);

  const smileBtnRef = useRef(null);
  const hoverActionsRef = useRef(null);
  const hoverLeaveTimerRef = useRef(null);
  const drawerRef = useRef(null);
  const [hoverActionsStyle, setHoverActionsStyle] = useState(null);
  const [canHover, setCanHover] = useState(() => window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)').matches);
  const [drawerStyle, setDrawerStyle] = useState(null);
  const isReactionOpen = showMsgActionsId === msg.id;

  // useMessageTouch provides isInteractiveTarget filtering voice-play-btn, audio-progress-container, failed-message-menu, reaction-badge and swipe-to-reply
  const touchHandlers = useMessageTouch({
    onTrigger: () => setShowMsgActionsId(msg.id),
    onSwipeReply: () => {
      if (setReplyingTo) {
        setReplyingTo(msg);
      }
    },
    holdDurationMs: 380,
    moveThresholdPx: 10
  });

  const bubbleRef = useRef(null);
  const showHoverActions = canHover && (showMsgActionsId ? isReactionOpen : hoveredMessageId === msg.id);

  const revealHoverActions = useCallback(() => {
    clearTimeout(hoverLeaveTimerRef.current);
    setHoveredMessageId(msg.id);
  }, [msg.id, setHoveredMessageId]);

  const hideHoverActions = useCallback(() => {
    clearTimeout(hoverLeaveTimerRef.current);
    // Allow the pointer to cross the gap between the bubble and its portaled controls.
    hoverLeaveTimerRef.current = setTimeout(() => {
      if (!bubbleRef.current?.matches(':hover') && !hoverActionsRef.current?.matches(':hover') &&
          !hoverActionsRef.current?.contains(document.activeElement) && !drawerRef.current?.contains(document.activeElement)) {
        setHoveredMessageId(previous => previous === msg.id ? null : previous);
      }
    }, 150);
  }, [msg.id, setHoveredMessageId]);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)');
    const update = () => {
      setCanHover(query.matches);
      if (!query.matches) setHoveredMessageId(previous => previous === msg.id ? null : previous);
    };
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
      clearTimeout(hoverLeaveTimerRef.current);
    };
  }, [msg.id, setHoveredMessageId]);

  const repositionHoverActions = useCallback(() => {
    const bubble = bubbleRef.current;
    const actions = hoverActionsRef.current;
    if (!bubble || !actions) return;
    const rect = bubble.getBoundingClientRect();
    const chatRect = bubble.closest('.chat-body')?.getBoundingClientRect();
    const leftBound = Math.max(8, (chatRect?.left ?? 0) + 8);
    const rightBound = Math.min(window.innerWidth - 8, (chatRect?.right ?? window.innerWidth) - 8);
    const topBound = Math.max(8, (chatRect?.top ?? 0) + 4);
    const bottomBound = Math.min(window.innerHeight - 8, (chatRect?.bottom ?? window.innerHeight) - 4);
    if (rect.bottom <= topBound || rect.top >= bottomBound) {
      setHoveredMessageId(previous => previous === msg.id ? null : previous);
      setShowMsgActionsId(previous => previous === msg.id ? null : previous);
      return;
    }
    const width = actions.offsetWidth;
    const height = actions.offsetHeight;
    const before = rect.left - width - 8;
    const after = rect.right + 8;
    let left = isMe ? before : after;
    if (left < leftBound || left + width > rightBound) left = isMe ? after : before;
    left = Math.max(leftBound, Math.min(left, rightBound - width));
    const top = Math.max(topBound, Math.min(rect.top + (rect.height - height) / 2, bottomBound - height));
    setHoverActionsStyle({ left, top, visibility: 'visible' });
  }, [isMe, msg.id, setShowMsgActionsId, setHoveredMessageId]);

  useLayoutEffect(() => {
    if (!showHoverActions) return undefined;
    repositionHoverActions();
    const raf = requestAnimationFrame(repositionHoverActions);
    return () => cancelAnimationFrame(raf);
  }, [showHoverActions, repositionHoverActions]);

  useEffect(() => {
    if (!showHoverActions) return undefined;
    let raf = null;
    const reposition = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(repositionHoverActions);
    };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    const observer = new ResizeObserver(reposition);
    if (bubbleRef.current) observer.observe(bubbleRef.current);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
      observer.disconnect();
    };
  }, [showHoverActions, repositionHoverActions]);

  const handleBubblePointerDown = touchHandlers.handleBubblePointerDown;
  const handleBubblePointerMove = touchHandlers.handleBubblePointerMove;
  const handleBubblePointerUp = touchHandlers.handleBubblePointerUp;
  const clearLongPress = touchHandlers.clearLongPress;
  const handleContextMenu = touchHandlers.onContextMenu;
  const swipeOffset = touchHandlers.swipeOffset;
  const isSwiping = touchHandlers.isSwiping;

  const hasTail = isLastInGroup && !isSticker && !isVideoNote && !isPureImage && !isPureVideo;

  const repositionDrawer = useCallback(() => {
    if (!isReactionOpen || !smileBtnRef.current) return;

    const anchor = smileBtnRef.current;
    const rect = anchor.getBoundingClientRect();
    const viewportPad = 8;
    const gap = 8;

    // Prefer measured drawer size; fall back to ~8 emoji cells
    const drawerEl = drawerRef.current;
    const realWidth = drawerEl?.offsetWidth || Math.min(284, window.innerWidth - viewportPad * 2);
    const realHeight = drawerEl?.offsetHeight || 40;

    let top = rect.top - realHeight - gap;
    let placement = 'above';
    if (top < viewportPad) {
      top = rect.bottom + gap;
      placement = 'below';
    }

    // Bottom boundary viewport clamping
    const maxTop = window.innerHeight - realHeight - viewportPad;
    if (top > maxTop) {
      top = Math.max(viewportPad, maxTop);
    }

    // Keep whole bar inside the viewport horizontally
    let left = rect.left + rect.width / 2 - realWidth / 2;
    const maxLeft = window.innerWidth - realWidth - viewportPad;
    left = Math.max(viewportPad, Math.min(left, maxLeft));

    setDrawerStyle({
      position: 'fixed',
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      zIndex: 10050,
      visibility: 'visible',
      ['--reaction-placement']: placement
    });
  }, [isReactionOpen]);

  useLayoutEffect(() => {
    if (!isReactionOpen) {
      setDrawerStyle(null);
      return;
    }
    // Drawer is mounted (possibly off-screen); measure then place
    repositionDrawer();
    const raf = requestAnimationFrame(() => repositionDrawer());
    return () => cancelAnimationFrame(raf);
  }, [isReactionOpen, repositionDrawer, hoverActionsStyle]);

  useEffect(() => {
    if (!isReactionOpen) return undefined;

    const onScrollOrResize = () => repositionDrawer();
    window.addEventListener('resize', onScrollOrResize);
    // Capture scroll from chat-body and nested scrollers
    document.addEventListener('scroll', onScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [isReactionOpen, repositionDrawer]);

  const renderStatusIcons = () => {
    if (!isMe) return null;
    if (msg.isFailed) {
      return (
        <AlertCircle
          className="seen-check failed"
          style={{ width: '12px', height: '12px', color: '#f87171', cursor: 'pointer', pointerEvents: 'auto' }}
          onClick={(e) => {
            e.stopPropagation();
            setRetryMenuMsgId(retryMenuMsgId === msg.id ? null : msg.id);
          }}
        />
      );
    }
    if (msg.isPending) return <PendingClock className="seen-check pending" style={{ width: '10px', height: '10px' }} />;
    if (activeChat.type === 'channel') return <SingleCheck className="seen-check" style={{ width: '10px', height: '10px' }} />;
    if (msg.read) return <DoubleCheck className="seen-check blue" style={{ width: '10px', height: '10px' }} />;
    return <SingleCheck className="seen-check" style={{ width: '10px', height: '10px' }} />;
  };

  const renderMetadata = (extraClass = '') => (
    <span className={`bubble-metadata ${extraClass}`.trim()}>
      <span className="message-time">{getFormatTime(msg.timestamp)}</span>
      {isMe && <span className="check-icons">{renderStatusIcons()}</span>}
    </span>
  );

  // An invisible inline copy reserves the actual time width, including the receipt.
  // The visible metadata can then sit at the right edge of the final text line.
  const renderMetadataSpacer = () => (
    <span className="bubble-metadata-spacer" aria-hidden="true">
      <span>{getFormatTime(msg.timestamp)}</span>
      {isMe && <span style={{ width: msg.isFailed ? 12 : 10 }} />}
    </span>
  );

  return (
    <div
      key={msg.id}
      className={`message-row ${isMe ? 'row-me' : 'row-other'} ${isFirstInGroup ? 'group-first' : ''} ${isLastInGroup ? 'group-last' : ''}`}
      data-message-id={msg.id}
      data-message-timestamp={msg.timestamp == null ? undefined : new Date(msg.timestamp).getTime()}
      data-message-sender-id={msg.senderId}
      onMouseLeave={() => {
        if (showMsgActionsId !== msg.id) {
          setShowMsgActionsId(null);
        }
      }}
    >
      {/* Group Avatar for incoming messages */}
      {isGroupOther && (
        <div className="message-avatar-col">
          {isLastInGroup ? (
            <div
              className="message-sender-avatar interactive"
              onClick={handleSenderClick}
              title={`Открыть профиль ${senderDisplayName}`}
              style={{ cursor: 'pointer' }}
            >
              {renderAvatar(senderAvatar, personAvatarFallback(senderMember || { name: senderDisplayName }))}
            </div>
          ) : (
            <div className="avatar-spacer" />
          )}
        </div>
      )}

      {/* Bubble */}
      <div
        ref={bubbleRef}
        className={`message-bubble ${isMe ? 'bubble-me' : 'bubble-other'} ${isVideoNote ? 'bubble-video' : ''} ${isRegularVideo ? 'bubble-regular-video' : ''} ${isSticker ? 'bubble-sticker' : ''} ${isPureImage || isPureVideo ? 'bubble-media-only' : ''} ${showSenderName ? 'has-sender-name' : ''} ${isImageWithCaption || isVideoWithCaption ? 'bubble-media-with-caption' : ''} ${hasTail ? 'has-tail' : ''} ${isSearchMatchTarget ? 'search-match-target' : ''}`}
        style={{
          transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined,
          transition: isSwiping ? 'none' : 'transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        onPointerDown={handleBubblePointerDown}
        onPointerMove={handleBubblePointerMove}
        onPointerUp={handleBubblePointerUp}
        onPointerCancel={clearLongPress}
        onContextMenu={handleContextMenu}
        onMouseEnter={revealHoverActions}
        onMouseLeave={hideHoverActions}
      >
        {swipeOffset !== 0 && (
          <div
            className="message-swipe-reply-indicator"
            style={{
              position: 'absolute',
              top: '50%',
              [swipeOffset > 0 ? 'left' : 'right']: '-36px',
              transform: `translateY(-50%) scale(${Math.min(1, Math.abs(swipeOffset) / 35)})`,
              opacity: Math.min(1, Math.abs(swipeOffset) / 35),
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-color, #2481cc)',
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              zIndex: 5
            }}
          >
            <CornerUpLeft size={16} />
          </div>
        )}
        {showSenderName && (
          <span
            className="sender-name interactive"
            onClick={handleSenderClick}
            style={{ color: getSenderColor(msg.senderId || msg.sender_id || senderDisplayName), display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
            title={`Открыть профиль ${senderDisplayName}`}
          >
            {senderDisplayName}
          </span>
        )}

        {/* Reply Context in Bubble */}
        {replyMsg && (
          <div className="reply-preview-bubble">
            <span className="reply-preview-sender">{replyMsg.senderName}</span>
            <p className="reply-preview-text">
              {(() => {
                const info = getReplyType(replyMsg);
                if (info.type === 'image') return <><Camera size={12} className="reply-media-svg" /> Фото</>;
                if (info.type === 'video') return <><Video size={12} className="reply-media-svg" /> Видео</>;
                if (info.type === 'video_note') return <><Video size={12} className="reply-media-svg" /> Видеосообщение</>;
                if (info.type === 'voice') return <><Mic size={12} className="reply-media-svg" /> Голосовое сообщение</>;
                if (info.type === 'sticker') return <><Smile size={12} className="reply-media-svg" /> Стикер</>;
                return info.text;
              })()}
            </p>
          </div>
        )}

        {/* Pure Media without caption */}
        {isPureImage ? (
          <div className="bubble-media-wrapper">
            <DecryptedImage
              mediaUrl={msg.media}
              chatId={activeChat.id}
              onOpen={setOpenedImageUrl}
            />
            {renderMetadata('floating-badge')}
          </div>
        ) : isImageWithCaption ? (
          <>
            <div className="bubble-media-wrapper">
              <DecryptedImage
                mediaUrl={msg.media}
                chatId={activeChat.id}
                onOpen={setOpenedImageUrl}
              />
            </div>
            <div className="bubble-caption">
              <p className="message-text">
                {msg.isLocked && <Lock size={13} style={{ color: 'var(--text-secondary)', opacity: 0.8, marginRight: 4 }} />}
                <span dir="auto">{renderMessageTextWithLinks(msg.text, searchQuery)}</span>
                {renderMetadataSpacer()}
                {renderMetadata()}
              </p>
            </div>
          </>
        ) : isPureVideo ? (
          <div className="bubble-media-wrapper">
            <DecryptedRegularVideoPlayer
              mediaUrl={msg.media}
              chatId={activeChat.id}
              onOpen={setOpenedImageUrl}
            />
            {renderMetadata('floating-badge video-floating-badge')}
          </div>
        ) : isVideoWithCaption ? (
          <>
            <div className="bubble-media-wrapper">
              <DecryptedRegularVideoPlayer
                mediaUrl={msg.media}
                chatId={activeChat.id}
                onOpen={setOpenedImageUrl}
              />
            </div>
            <div className="bubble-caption">
              <p className="message-text">
                {msg.isLocked && <Lock size={13} style={{ color: 'var(--text-secondary)', opacity: 0.8, marginRight: 4 }} />}
                <span dir="auto">{renderMessageTextWithLinks(msg.text, searchQuery)}</span>
                {renderMetadataSpacer()}
                {renderMetadata()}
              </p>
            </div>
          </>
        ) : isSticker ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <DecryptedSticker mediaUrl={msg.media} chatId={activeChat.id} />
            {renderMetadata('floating-badge sticker-metadata')}
          </div>
        ) : isVideoNote ? (
          <div style={{ position: 'relative' }}>
            <DecryptedVideoPlayer mediaUrl={msg.media} chatId={activeChat.id} />
            {renderMetadata('floating-badge')}
          </div>
        ) : (
          /* Text / Voice content */
          <div className="bubble-content">
            {isVoice ? (
              <div className="bubble-voice-content">
                <DecryptedVoicePlayer
                  mediaUrl={msg.media}
                  chatId={activeChat.id}
                  duration={(() => {
                    const match = msg.text?.match(/\((\d+):(\d+)\)/);
                    return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : 0;
                  })()}
                />
                {renderMetadata()}
              </div>
            ) : (msg.text && msg.text.startsWith('```')) ? (
              <div className="bubble-code-content">
                <pre className="code-block">
                  <code>{msg.text.replace(/```/g, '')}</code>
                </pre>
                {renderMetadata()}
              </div>
            ) : (
              <p className="message-text">
                {msg.isLocked && <Lock size={13} style={{ color: 'var(--text-secondary)', opacity: 0.8, marginRight: 4 }} />}
                <span dir="auto">{renderMessageTextWithLinks(msg.text, searchQuery)}</span>
                {renderMetadataSpacer()}
                {renderMetadata()}
              </p>
            )}
          </div>
        )}

        {/* Quick Reactions Render */}
        {msg.reactions && msg.reactions.length > 0 && (
          <div className="bubble-reactions">
            {msg.reactions.map(r => {
              const normalizedReaction = normalizeReaction(r);
              return (
                <button
                  key={r.emoji}
                  className={`reaction-badge ${(normalizedReaction.users.includes('current') || (currentUser && normalizedReaction.users.includes(currentUser.id))) ? 'active' : ''}`}
                  onClick={() => toggleReaction(activeChat.id, msg.id, r.emoji)}
                >
                  {r.emoji} <span className="react-count">{normalizedReaction.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Action hover tools */}
        {showHoverActions && createPortal(<div
          ref={hoverActionsRef}
          className="message-hover-actions message-hover-actions-fixed active"
          data-message-actions-for={msg.id}
          style={hoverActionsStyle || { visibility: 'hidden' }}
          role="toolbar"
          aria-label="Действия сообщения"
          onMouseEnter={revealHoverActions}
          onMouseLeave={hideHoverActions}
          onFocus={revealHoverActions}
          onBlur={hideHoverActions}
        >
          <button
            className="hover-action-btn"
            onClick={() => setReplyingTo(msg)}
            title="Ответить"
          >
            <CornerUpLeft size={14} />
          </button>
          <button
            ref={smileBtnRef}
            type="button"
            className="hover-action-btn"
            title="Реакция"
            aria-expanded={isReactionOpen}
            onClick={() => {
              if (showMsgActionsId === msg.id) {
                setShowMsgActionsId(null);
              } else {
                setShowMsgActionsId(msg.id);
              }
            }}
          >
            <Smile size={14} />
          </button>
          <button
            type="button"
            className="hover-action-btn delete"
            onClick={() => deleteMessage(activeChat.id, msg.id)}
            title="Удалить"
          >
            <Trash2 size={14} />
          </button>

          {/* Portal + fixed: not clipped/squeezed by chat scroll or content-visibility */}
          {isReactionOpen &&
            createPortal(
              <div
                ref={drawerRef}
                className={`reaction-drawer reaction-drawer-fixed${
                  drawerStyle?.['--reaction-placement'] === 'below'
                    ? ' reaction-drawer-below'
                    : ''
                }`}
                style={
                  drawerStyle || {
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    zIndex: 10050
                  }
                }
                role="listbox"
                aria-label="Реакции"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {emojis.slice(0, 8).map(emo => (
                  <button
                    key={emo}
                    type="button"
                    role="option"
                    className="reaction-drawer-item"
                    onClick={() => {
                      toggleReaction(activeChat.id, msg.id, emo);
                      setShowMsgActionsId(null);
                      hideHoverActions();
                    }}
                  >
                    {emo}
                  </button>
                ))}
              </div>,
              document.body
            )}
        </div>, document.body)}

        {retryMenuMsgId === msg.id && (
          <div className="failed-message-menu">
            <button className="failed-menu-btn retry" onClick={(e) => {
              e.stopPropagation();
              retrySendMessage(msg.id);
              setRetryMenuMsgId(null);
            }}>
              Повторить
            </button>
            <button className="failed-menu-btn delete" onClick={(e) => {
              e.stopPropagation();
              deleteFailedMessage(msg.id);
              setRetryMenuMsgId(null);
            }}>
              Удалить
            </button>
          </div>
        )}

        {/* Mobile Action Sheet (portaled to document.body) */}
        <MobileActionSheet
          isOpen={isReactionOpen}
          msg={msg}
          message={msg}
          activeChat={activeChat}
          currentUser={currentUser}
          emojis={emojis}
          isOutgoing={isMe}
          onClose={() => setShowMsgActionsId(null)}
          onReply={setReplyingTo}
          setReplyingTo={setReplyingTo}
          onReactionSelect={(emo) => toggleReaction?.(activeChat?.id, msg.id, emo)}
          toggleReaction={toggleReaction}
          onDelete={(m) => deleteMessage?.(activeChat?.id, m?.id || msg.id)}
          deleteMessage={deleteMessage}
        />
      </div>
    </div>
  );
}
