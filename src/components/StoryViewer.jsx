import './Stories.css';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useChat } from '../context/ChatContext';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Trash2,
  Eye,
  Plus,
  Send
} from 'lucide-react';
import useResolvedMedia from '../hooks/useResolvedMedia';
import { personAvatarFallback } from '../context/chat/avatarFallback';
import { triggerHaptic } from '../hooks/useMessageTouch';

export default function StoryViewer() {
  const {
    currentUser,
    chats,
    sendMessage,
    stories,
    activeStoryId,
    setActiveStoryId,
    renderAvatar,
    viewStory,
    deleteStory,
    setIsCreateStoryOpen
  } = useChat();

  const [isManualPaused, setIsManualPaused] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [lastActiveStoryId, setLastActiveStoryId] = useState(null);
  const [mediaRetryKey, setMediaRetryKey] = useState(0);
  const [imageRenderError, setImageRenderError] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySentFeedback, setReplySentFeedback] = useState(false);
  const [floatingReaction, setFloatingReaction] = useState(null);

  const isPaused = isManualPaused || isHolding;

  useEffect(() => {
    if (activeStoryId) {
      setLastActiveStoryId(activeStoryId);
    }
  }, [activeStoryId]);

  const displayStoryId = activeStoryId || lastActiveStoryId;
  const displayStory = stories.find((s) => s.id === displayStoryId);
  const isOwnStory = displayStory?.userId === currentUser?.id;

  // Group stories by user while maintaining list order
  const groupedUsers = useMemo(() => {
    const userMap = new Map();
    for (const s of stories) {
      if (!userMap.has(s.userId)) {
        userMap.set(s.userId, []);
      }
      userMap.get(s.userId).push(s);
    }
    return Array.from(userMap.values());
  }, [stories]);

  const currentUserGroupIndex = useMemo(() => {
    if (!displayStory) return -1;
    return groupedUsers.findIndex((group) => group.some((s) => s.id === displayStory.id));
  }, [groupedUsers, displayStory]);

  const userStories = useMemo(() => {
    return displayStory ? stories.filter((s) => s.userId === displayStory.userId) : [];
  }, [displayStory, stories]);

  const activeIndexInUserStories = userStories.findIndex((s) => s.id === displayStoryId);

  const {
    url: storyMediaUrl,
    loading: storyMediaLoading,
    error: storyMediaError
  } = useResolvedMedia(displayStory?.media, null, 'image/jpeg', mediaRetryKey);

  useEffect(() => {
    setMediaRetryKey(0);
    setImageRenderError(false);
    setReplyText('');
    setReplySentFeedback(false);
    setFloatingReaction(null);
  }, [displayStoryId]);

  const retryMedia = () => {
    setImageRenderError(false);
    setMediaRetryKey((key) => key + 1);
  };

  const DURATION = 5000; // 5 seconds per story
  const timeoutRef = useRef(null);
  const startTimeRef = useRef(null);
  const remainingTimeRef = useRef(DURATION);
  const touchStartRef = useRef(null);
  const holdTimerRef = useRef(null);

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    remainingTimeRef.current = DURATION;
    startTimeRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    resetTimer();
    setIsHolding(false);
    setIsManualPaused(false);
    setActiveStoryId(null);
  }, [resetTimer, setActiveStoryId]);

  // Telegram cross-user story navigation
  const handleNext = useCallback(() => {
    triggerHaptic(6);
    if (activeIndexInUserStories < userStories.length - 1) {
      // Advance to next story of the same user
      resetTimer();
      setIsHolding(false);
      setActiveStoryId(userStories[activeIndexInUserStories + 1].id);
    } else if (currentUserGroupIndex >= 0 && currentUserGroupIndex < groupedUsers.length - 1) {
      // Advance to next user's first story
      const nextUserStories = groupedUsers[currentUserGroupIndex + 1];
      if (nextUserStories && nextUserStories.length > 0) {
        resetTimer();
        setIsHolding(false);
        const nextStory = nextUserStories.find((s) => !s.viewed) || nextUserStories[0];
        setActiveStoryId(nextStory.id);
      } else {
        handleClose();
      }
    } else {
      handleClose();
    }
  }, [
    activeIndexInUserStories,
    userStories,
    currentUserGroupIndex,
    groupedUsers,
    resetTimer,
    handleClose,
    setActiveStoryId
  ]);

  const handlePrev = useCallback(() => {
    triggerHaptic(6);
    if (activeIndexInUserStories > 0) {
      // Previous story of current user
      resetTimer();
      setIsHolding(false);
      setActiveStoryId(userStories[activeIndexInUserStories - 1].id);
    } else if (currentUserGroupIndex > 0) {
      // Previous user's last story
      const prevUserStories = groupedUsers[currentUserGroupIndex - 1];
      if (prevUserStories && prevUserStories.length > 0) {
        resetTimer();
        setIsHolding(false);
        setActiveStoryId(prevUserStories[prevUserStories.length - 1].id);
      }
    }
  }, [
    activeIndexInUserStories,
    userStories,
    currentUserGroupIndex,
    groupedUsers,
    resetTimer,
    setActiveStoryId
  ]);

  // When active story changes, reset timer
  useEffect(() => {
    resetTimer();
    setIsHolding(false);
  }, [activeStoryId, resetTimer]);

  // Timer effect for automatic playback
  useEffect(() => {
    if (
      !activeStoryId ||
      storyMediaLoading ||
      storyMediaError ||
      imageRenderError ||
      !storyMediaUrl
    ) {
      return;
    }

    if (isPaused) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (startTimeRef.current) {
        const elapsed = Date.now() - startTimeRef.current;
        remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
        startTimeRef.current = null;
      }
      return;
    }

    startTimeRef.current = Date.now();
    timeoutRef.current = setTimeout(() => {
      handleNext();
    }, remainingTimeRef.current);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    activeStoryId,
    isPaused,
    storyMediaLoading,
    storyMediaError,
    imageRenderError,
    storyMediaUrl,
    handleNext
  ]);

  // Automatically mark the current story as viewed
  useEffect(() => {
    if (activeStoryId) {
      viewStory(activeStoryId);
    }
  }, [activeStoryId, viewStory]);

  // Keyboard navigation
  useEffect(() => {
    if (!activeStoryId) return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsManualPaused((prev) => !prev);
      } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleNext();
      } else if (
        e.key === 'ArrowLeft' ||
        e.key === 'j' ||
        e.key === 'J' ||
        e.key === 'h' ||
        e.key === 'H'
      ) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStoryId, handleNext, handlePrev, handleClose]);

  // Pointer / Touch gestures
  const handlePointerDown = (e) => {
    if (e.target.closest('button, .story-icon-btn, .story-nav-btn, a, input, form')) {
      return;
    }

    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;
    touchStartRef.current = { x: clientX, y: clientY, time: Date.now(), isHold: false };

    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      if (touchStartRef.current) {
        touchStartRef.current.isHold = true;
        setIsHolding(true);
      }
    }, 180);
  };

  const handlePointerUp = (e) => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setIsHolding(false);

    if (!touchStartRef.current) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;

    const clientX = e.clientX ?? (e.changedTouches && e.changedTouches[0]?.clientX) ?? 0;
    const clientY = e.clientY ?? (e.changedTouches && e.changedTouches[0]?.clientY) ?? 0;
    const dx = clientX - start.x;
    const dy = clientY - start.y;
    const elapsed = Date.now() - start.time;

    // Horizontal swipe
    if (Math.abs(dx) > 50 && Math.abs(dy) < 80) {
      if (dx > 0) {
        handlePrev();
      } else {
        handleNext();
      }
      return;
    }

    // Quick tap (< 250ms and movement < 15px and not a hold)
    if (elapsed < 250 && Math.abs(dx) < 15 && Math.abs(dy) < 15 && !start.isHold) {
      const containerWidth = e.currentTarget?.offsetWidth || window.innerWidth;
      const rect = e.currentTarget?.getBoundingClientRect();
      const relativeX = rect ? clientX - rect.left : clientX;

      if (relativeX < containerWidth * 0.35) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  };

  const handlePointerCancel = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setIsHolding(false);
    touchStartRef.current = null;
  };

  const handleDeleteStory = async (e) => {
    e.stopPropagation();
    if (!displayStory) return;
    if (window.confirm('Удалить эту историю?')) {
      triggerHaptic(18);
      const storyToDelete = displayStory.id;
      if (userStories.length > 1) {
        handleNext();
      } else {
        handleClose();
      }
      if (deleteStory) {
        await deleteStory(storyToDelete);
      }
    }
  };

  const handleReaction = (emoji, e) => {
    e.stopPropagation();
    triggerHaptic(12);
    setFloatingReaction(emoji);
    setTimeout(() => setFloatingReaction(null), 1300);
  };

  const handleSendReply = async (e) => {
    if (e) e.preventDefault();
    if (!replyText.trim() || !displayStory) return;

    triggerHaptic(15);
    const targetChat = chats?.find(
      (c) => c.type === 'personal' && c.members?.some((m) => m.id === displayStory.userId)
    );

    if (targetChat && sendMessage) {
      await sendMessage(targetChat.id, `Ответ на историю: ${replyText.trim()}`);
    }

    setReplyText('');
    setReplySentFeedback(true);
    setTimeout(() => setReplySentFeedback(false), 2000);
  };

  if (!displayStory) return null;

  return (
    <div
      className={`story-viewer-overlay ${activeStoryId ? 'open' : ''}`}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Background glass blur */}

      {/* Floating Reaction Animation */}
      {floatingReaction && (
        <div className="story-floating-reaction-bubble">
          {floatingReaction}
        </div>
      )}

      {/* Story Container */}
      <div
        className="story-container"
        onPointerDown={handlePointerDown}
      >
        {/* Top Progress Bars */}
        <div className="story-progress-container">
          {userStories.map((s, idx) => {
            let statusClass = '';
            if (idx < activeIndexInUserStories) statusClass = 'filled';
            else if (idx === activeIndexInUserStories) statusClass = `active ${isPaused ? 'paused' : ''}`;

            return (
              <div key={s.id} className="story-progress-track">
                <div
                  key={`${s.id}-${displayStoryId}`}
                  className={`story-progress-fill ${statusClass}`}
                />
              </div>
            );
          })}
        </div>

        {/* Story Header */}
        <div className="story-header">
          <div className="story-user-info">
            <div className="story-user-avatar" style={{ padding: 0 }}>
              {renderAvatar(displayStory.userAvatar, personAvatarFallback(displayStory))}
            </div>
            <div className="story-user-meta">
              <span className="story-user-name">{displayStory.userName}</span>
              <span className="story-user-time">{displayStory.timestamp}</span>
            </div>
          </div>
          <div className="story-header-actions">
            <button
              type="button"
              className="story-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsManualPaused((prev) => !prev);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={isPaused ? 'Воспроизвести' : 'Пауза'}
              title={isPaused ? 'Воспроизвести (Пробел)' : 'Пауза (Пробел)'}
            >
              {isPaused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button
              type="button"
              className="story-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Next/Prev Navigation chevron buttons */}
        <div className="story-nav-triggers">
          <button
            type="button"
            className="story-nav-btn prev"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={activeIndexInUserStories === 0 && currentUserGroupIndex === 0}
            aria-label="Предыдущая история"
          >
            <ChevronLeft size={28} />
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="story-nav-btn next"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Следующая история"
          >
            <ChevronRight size={28} />
          </button>
        </div>

        {/* Story Image Content */}
        <div className="story-media-wrapper">
          {storyMediaLoading ? (
            <div className="story-media-status">
              <div className="spinner story-media-spinner" />
              <span>Загрузка истории...</span>
            </div>
          ) : storyMediaError || imageRenderError || !storyMediaUrl ? (
            <div className="story-media-status story-media-error">
              <span>История недоступна</span>
              <button type="button" onClick={retryMedia}>Повторить</button>
            </div>
          ) : (
            <img
              key={displayStoryId}
              src={storyMediaUrl}
              alt={displayStory.caption || 'История'}
              className="story-img"
              draggable="false"
              onDragStart={(e) => e.preventDefault()}
              onError={() => setImageRenderError(true)}
            />
          )}
        </div>

        {/* =========================================================
            TELEGRAM INTERACTIVE FOOTER (Captions, Reactions, Replies, Owner actions)
           ========================================================= */}
        <div className={`story-footer ${isOwnStory ? 'owner-footer' : 'viewer-footer'}`}>
          {/* Caption text */}
          {displayStory.caption && (
            <p className="story-caption">{displayStory.caption}</p>
          )}

          {/* Owner controls */}
          {isOwnStory ? (
            <div className="story-owner-bar">
              <div className="story-views-badge">
                <Eye size={15} />
                <span>1 просмотр</span>
              </div>
              <div className="story-owner-actions">
                <button
                  type="button"
                  className="story-action-btn delete-btn"
                  onClick={handleDeleteStory}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Удалить историю"
                >
                  <Trash2 size={16} />
                  <span>Удалить</span>
                </button>
                <button
                  type="button"
                  className="story-action-btn add-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose();
                    setIsCreateStoryOpen(true);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Добавить историю"
                >
                  <Plus size={16} />
                  <span>Добавить</span>
                </button>
              </div>
            </div>
          ) : (
            /* Viewer controls (Reactions + Quick Reply) */
            <div className="story-viewer-interaction-bar">
              <div className="story-reactions-row">
                {['❤️', '🔥', '👍', '😂', '🎉', '👏'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="story-reaction-pill"
                    onClick={(e) => handleReaction(emoji, e)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={`Отправить реакцию ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <form
                className="story-reply-form"
                onSubmit={handleSendReply}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  className="story-reply-input"
                  placeholder={replySentFeedback ? 'Ответ отправлен!' : 'Ответить на историю...'}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  disabled={replySentFeedback}
                />
                {replyText.trim() && (
                  <button
                    type="submit"
                    className="story-reply-send-btn"
                    title="Отправить ответ"
                  >
                    <Send size={15} />
                  </button>
                )}
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
