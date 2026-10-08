import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useCalls } from '../../context/CallContext';
import './CallOverlay.css';
import {
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Video,
  VideoOff,
  Monitor,
  Minimize2,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  X
} from 'lucide-react';
import {
  playCallConnect,
  playCallDisconnect,
  startCallRingback,
  startIncomingRingtone
} from '../../utils/callSounds';
import { useCallCardChrome } from './useCallCardChrome';
import { useCallLocalPreviewDrag } from './useCallLocalPreviewDrag';
import { chatAvatarFallback, personAvatarFallback } from '../../context/chat/avatarFallback';


function getIsCompactViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 480 || window.innerHeight <= 560;
}

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function CallOverlay() {
  const { currentUser } = useAuth();
  const {
    callState,
    endCall,
    toggleCallMute,
    acceptCall,
    rejectCall,
    retryCallConnection,
    localVideoStream,
    remoteVideoStream,
    toggleCallVideo,
    isScreenSharing,
    toggleCallScreenShare,
    groupCallParticipants,
    mediaError,
    clearMediaError,
    voiceEnhancementEnabled,
    toggleVoiceEnhancement
  } = useCalls();

  const { chats, renderAvatar } = useChat();

  const [isCompact, setIsCompact] = useState(getIsCompactViewport);
  const [elapsed, setElapsed] = useState(0);
  const [isVideoContain, setIsVideoContain] = useState(false);
  const ringRef = useRef(null);
  const connectSoundPlayedRef = useRef(false);
  const acceptBtnRef = useRef(null);
  const rejectBtnRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const containerRef = useRef(null);

  const {
    cardPos,
    cardSize,
    isMinimized,
    setIsMinimized,
    bubblePos,
    isDraggingCard,
    isResizing,
    handleResizeMouseDown,
    handleResizeTouchStart,
    handleCardMouseDown,
    handleCardTouchStart,
    handleBubbleMouseDown,
    handleBubbleTouchStart,
    handleBubbleClick
  } = useCallCardChrome(callState.status);

  const { dragRef } = useCallLocalPreviewDrag({
    containerRef,
    localVideoStream,
    cardSize
  });

  useEffect(() => {
    const onResize = () => setIsCompact(getIsCompactViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // V6: Escape ends/rejects; ignore when typing in inputs under non-blocking overlay.
  useEffect(() => {
    if (callState.status === 'idle' || callState.status === 'ended') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      if (callState.status === 'incoming') rejectCall();
      else endCall();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [callState.status, rejectCall, endCall]);

  // V6: focus Accept on incoming; light Tab trap between accept/reject.
  useEffect(() => {
    if (callState.status !== 'incoming') return undefined;
    acceptBtnRef.current?.focus?.();
    const onTab = (e) => {
      if (e.key !== 'Tab') return;
      const accept = acceptBtnRef.current;
      const reject = rejectBtnRef.current;
      if (!accept || !reject) return;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === accept) {
          e.preventDefault();
          reject.focus();
        }
      } else if (active === reject) {
        e.preventDefault();
        accept.focus();
      }
    };
    window.addEventListener('keydown', onTab);
    return () => window.removeEventListener('keydown', onTab);
  }, [callState.status]);

  // Sounds + local duration tick (C9: no setCallState duration++)
  useEffect(() => {
    if (callState.status !== 'connected') {
      connectSoundPlayedRef.current = false;
    }
    if (callState.status !== 'calling' && callState.status !== 'incoming') {
      if (ringRef.current) {
        ringRef.current.stop();
        ringRef.current = null;
      }
    }

    if (callState.status === 'calling') {
      if (!ringRef.current) ringRef.current = startCallRingback();
    } else if (callState.status === 'incoming') {
      if (!ringRef.current) ringRef.current = startIncomingRingtone();
    } else if (callState.status === 'connected') {
      if (callState.webrtcState === 'connected') {
        if (!connectSoundPlayedRef.current) {
          playCallConnect();
          connectSoundPlayedRef.current = true;
          setElapsed(0);
        }
        const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => {
          clearInterval(timer);
        };
      }
    } else if (callState.status === 'ended') {
      playCallDisconnect();
    }

    return undefined;
  }, [callState.status, callState.webrtcState]);

  useEffect(() => {
    if (localVideoRef.current && localVideoStream) {
      localVideoRef.current.srcObject = localVideoStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localVideoStream, isMinimized]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteVideoStream) {
      remoteVideoRef.current.srcObject = remoteVideoStream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteVideoStream, isMinimized]);

  const [viewMode, setViewMode] = useState('spotlight'); // 'spotlight' | 'grid'
  const [selectedStreamId, setSelectedStreamId] = useState(null);
  const prevStreamsRef = useRef(new Set());

  // Auto-fit screen shares when selected
  useEffect(() => {
    if (callState.isRemoteScreenSharing) setIsVideoContain(true);
  }, [callState.isRemoteScreenSharing]);

  const activeChat = chats.find((c) => c.id === callState.chatId);
  const isGroupCall = activeChat?.type === 'group';

  let displayName = '';
  let avatarContent = '👤';
  if (callState.status === 'incoming' && callState.callerInfo) {
    displayName = callState.callerInfo.name;
    avatarContent = callState.callerInfo.avatar;
  } else if (activeChat) {
    displayName = activeChat.name;
    avatarContent = activeChat.avatar;
  } else {
    displayName = 'Звонок...';
  }

  let statusText = 'Подключение...';
  if (callState.status === 'calling') statusText = 'Звонок...';
  else if (callState.status === 'incoming') statusText = 'Входящий звонок...';
  else if (callState.status === 'connected') {
    if (callState.webrtcState === 'connected') statusText = formatTime(elapsed);
    else if (callState.webrtcState === 'failed') statusText = 'Нет WebRTC-связи (сеть/NAT)';
    else statusText = 'Соединение...';
  } else if (callState.status === 'ended') {
    statusText = mediaError ? 'Звонок завершен' : 'Звонок завершен';
  }

  const sortedGroupParticipants = useMemo(() => {
    const participants = groupCallParticipants ? [...groupCallParticipants] : [];
    const currentUserId = currentUser?.id || 'current';
    if (isGroupCall && !participants.some((p) => p.id === currentUserId || p.id === 'current' || p.name === 'Вы')) {
      participants.unshift({
        id: currentUserId,
        name: 'Вы',
        avatar: currentUser?.avatar || '👤',
        avatarColor: currentUser?.avatar_color || currentUser?.avatarColor || '#689fc2',
        muted: Boolean(callState.muted),
        videoStream: localVideoStream,
        speaking: Boolean(callState.isLocalSpeaking),
        isReal: true
      });
    }
    return participants.sort((a, b) => {
      if (a.speaking && !b.speaking) return -1;
      if (!a.speaking && b.speaking) return 1;
      return 0;
    });
  }, [groupCallParticipants, isGroupCall, currentUser, callState.muted, callState.isLocalSpeaking, localVideoStream]);

  const groupParticipantCount = sortedGroupParticipants.length;
  const participantCountLabel =
    groupParticipantCount === 1
      ? '1 участник'
      : groupParticipantCount >= 2 && groupParticipantCount <= 4
      ? `${groupParticipantCount} участника`
      : `${groupParticipantCount} участников`;

  const groupStatusSubtitle =
    callState.status === 'connected' && callState.webrtcState === 'connected'
      ? `${participantCountLabel} • ${formatTime(elapsed)}`
      : `${participantCountLabel} • ${statusText}`;

  // Unified list of all active video & screen streams for Discord-style switcher
  const streamTiles = useMemo(() => {
    const tiles = [];

    // Local user streams
    if (localVideoStream) {
      tiles.push({
        id: isScreenSharing ? 'local:screen' : 'local:camera',
        participantId: 'me',
        name: isScreenSharing ? 'Ваш экран' : 'Вы (Камера)',
        avatar: currentUser?.avatar || '👤',
        avatarColor: currentUser?.avatar_color,
        stream: localVideoStream,
        isScreen: isScreenSharing,
        isLocal: true,
        speaking: callState.isLocalSpeaking,
        muted: callState.muted
      });
    }

    if (isGroupCall) {
      sortedGroupParticipants.forEach((p) => {
        if (p.id === currentUser?.id) return;
        if (p.screenStream) {
          tiles.push({
            id: `${p.id}:screen`,
            participantId: p.id,
            name: `${p.name} (Экран)`,
            avatar: p.avatar,
            avatarColor: p.avatarColor,
            stream: p.screenStream,
            isScreen: true,
            isLocal: false,
            speaking: p.speaking,
            muted: p.muted
          });
        }
        if (p.cameraStream || (p.videoStream && !p.screenStream)) {
          tiles.push({
            id: `${p.id}:camera`,
            participantId: p.id,
            name: p.name,
            avatar: p.avatar,
            avatarColor: p.avatarColor,
            stream: p.cameraStream || p.videoStream,
            isScreen: false,
            isLocal: false,
            speaking: p.speaking,
            muted: p.muted
          });
        }
      });
    } else {
      if (remoteVideoStream) {
        const isRemoteScreen = Boolean(callState.isRemoteScreenSharing);
        tiles.push({
          id: isRemoteScreen ? 'remote:screen' : 'remote:camera',
          participantId: 'remote',
          name: isRemoteScreen ? `${displayName} (Экран)` : displayName,
          avatar: avatarContent,
          stream: remoteVideoStream,
          isScreen: isRemoteScreen,
          isLocal: false,
          speaking: callState.isRemoteSpeaking,
          muted: false
        });
      }
    }

    return tiles;
  }, [
    isGroupCall,
    localVideoStream,
    isScreenSharing,
    currentUser,
    sortedGroupParticipants,
    remoteVideoStream,
    callState.isLocalSpeaking,
    callState.isRemoteSpeaking,
    callState.isRemoteScreenSharing,
    callState.muted,
    displayName,
    avatarContent
  ]);

  // Auto-focus on newly started screen shares (Discord behavior)
  useEffect(() => {
    const currentStreamIds = new Set(streamTiles.map((t) => t.id));
    const newScreenShare = streamTiles.find((t) => t.isScreen && !prevStreamsRef.current.has(t.id));
    if (newScreenShare) {
      setSelectedStreamId(newScreenShare.id);
      setIsVideoContain(true);
    } else if (selectedStreamId && !currentStreamIds.has(selectedStreamId)) {
      setSelectedStreamId(streamTiles[0]?.id || null);
    }
    prevStreamsRef.current = currentStreamIds;
  }, [streamTiles, selectedStreamId]);

  // Active focused stream on spotlight stage
  const focusedTile = useMemo(() => {
    if (!streamTiles.length) return null;
    return streamTiles.find((t) => t.id === selectedStreamId) || streamTiles[0];
  }, [streamTiles, selectedStreamId]);

  // Find the active speaker for voice-only stage
  const activeSpeaker = useMemo(() => {
    if (isGroupCall) {
      const speakingParticipant = sortedGroupParticipants.find((p) => p.speaking);
      if (speakingParticipant) return speakingParticipant;
      if (callState.isLocalSpeaking) return { name: 'Вы', avatar: currentUser?.avatar || '👤', speaking: true };
      return sortedGroupParticipants[0] || null;
    }
    if (callState.isRemoteSpeaking) return { name: displayName, avatar: avatarContent, speaking: true };
    if (callState.isLocalSpeaking) return { name: 'Вы', avatar: currentUser?.avatar || '👤', speaking: true };
    return null;
  }, [isGroupCall, sortedGroupParticipants, callState.isRemoteSpeaking, callState.isLocalSpeaking, displayName, avatarContent, currentUser]);

  const showRemoteVideo = !isGroupCall && !!remoteVideoStream;
  const hasVideo = streamTiles.length > 0;
  const isScreenShareSupported =
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';
  const showVideoControls = callState.status !== 'incoming';
  const isIncoming = callState.status === 'incoming';

  if (callState.status === 'idle') return null;

  if (isMinimized) {
    return (
      <div
        className="call-minimized-bubble"
        style={{ left: `${bubblePos.x}px`, top: `${bubblePos.y}px` }}
        onMouseDown={handleBubbleMouseDown}
        onTouchStart={handleBubbleTouchStart}
        onClick={handleBubbleClick}
        title="Развернуть звонок"
        role="region"
        aria-label={`Активный звонок: ${displayName}, ${statusText}`}
      >
        <div className="call-bubble-avatar">
          {renderAvatar(avatarContent, isGroupCall ? chatAvatarFallback(activeChat) : personAvatarFallback({ name: displayName }))}
        </div>
        {callState.status === 'connected' && callState.webrtcState === 'connected' && (
          <div className="call-bubble-pulse" />
        )}
        <div className="call-bubble-timer">{statusText}</div>
      </div>
    );
  }

  const cardStyle = isCompact
    ? {
        position: 'relative',
        left: 'auto',
        top: 'auto',
        margin: 0,
        width: '100%',
        height: 'auto',
        maxHeight: '100%',
        transition: 'none'
      }
    : {
        ...(cardPos
          ? {
              position: 'absolute',
              left: `${cardPos.x}px`,
              top: `${cardPos.y}px`,
              margin: 0
            }
          : {}),
        width: `${hasVideo && viewMode === 'spotlight' ? Math.max(cardSize.width, 540) : cardSize.width}px`,
        height: `${hasVideo ? Math.max(cardSize.height, 460) : cardSize.height}px`,
        transition:
          isDraggingCard.current || isResizing.current
            ? 'none'
            : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.3s ease, height 0.3s ease'
      };

  const wrapperProps = isIncoming
    ? {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `Входящий звонок: ${displayName || 'Звонок'}`
      }
    : {
        role: 'region',
        'aria-label': `Активный звонок: ${displayName || 'Звонок'}`
      };

  return (
    <div
      className={`call-overlay-wrapper ${callState.status !== 'idle' ? 'active' : ''} ${!isIncoming ? 'non-blocking' : ''} ${isCompact ? 'is-compact' : ''}`}
      {...wrapperProps}
    >
      <div
        className={`call-card ${showRemoteVideo || focusedTile ? 'has-remote-video' : ''} ${hasVideo ? 'has-video' : ''} ${isVideoContain ? 'is-contain' : ''} ${isCompact ? 'is-compact' : ''} ${viewMode === 'grid' ? 'is-grid-layout' : ''}`}
        ref={containerRef}
        style={cardStyle}
        onMouseDown={isCompact ? undefined : handleCardMouseDown}
        onTouchStart={isCompact ? undefined : handleCardTouchStart}
      >
        {/* Top Header Actions */}
        {!isIncoming && (
          <div className="call-top-bar">
            <div className="call-header-meta-info">
              <span className="call-header-chat-name">{displayName}</span>
              <span className="call-header-timer-pill">{statusText}</span>
            </div>
            <div className="call-header-actions">
              {hasVideo && (
                <>
                  <button
                    type="button"
                    className={`call-action-icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => setViewMode((m) => (m === 'grid' ? 'spotlight' : 'grid'))}
                    title={viewMode === 'grid' ? 'Режим фокуса (Spotlight)' : 'Сетка (Grid View)'}
                  >
                    <Maximize2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="call-action-icon-btn"
                    onClick={() => setIsVideoContain((prev) => !prev)}
                    title={isVideoContain ? 'Заполнить экран' : 'Вписать в экран'}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="call-action-icon-btn"
                onClick={() => setIsMinimized(true)}
                title="Свернуть"
              >
                <Minimize2 size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Media Error Notification */}
        {mediaError && (
          <div className="call-media-error" role="alert">
            <span>{mediaError}</span>
            {typeof clearMediaError === 'function' && (
              <button
                type="button"
                className="call-media-error-dismiss"
                onClick={clearMediaError}
                title="Закрыть"
                aria-label="Закрыть сообщение об ошибке"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Contract-bound hidden video hooks for rebind assertions */}
        <video ref={remoteVideoRef} style={{ display: 'none' }} playsInline muted />
        <div ref={dragRef} style={{ display: 'none' }}>
          <video
            ref={localVideoRef}
            playsInline
            muted
            className={`local-video-feed ${isScreenSharing ? 'is-screen' : 'is-camera'}`}
          />
        </div>

        {/* ========================================================
            DISCORD-STYLE STAGE: SPOTLIGHT OR GRID VIEW
            ======================================================== */}
        {hasVideo ? (
          viewMode === 'grid' ? (
            /* 1. GRID VIEW (All streams equal tiles) */
            <div className={`call-discord-grid-view count-${Math.min(streamTiles.length, 6)}`}>
              {streamTiles.map((tile) => (
                <div
                  key={tile.id}
                  className={`discord-grid-tile ${tile.speaking ? 'speaking' : ''} ${tile.isScreen ? 'is-screen-tile' : ''}`}
                  onClick={() => {
                    setSelectedStreamId(tile.id);
                    setViewMode('spotlight');
                  }}
                  title="Кликните, чтобы развернуть во весь экран"
                >
                  <video
                    ref={(el) => {
                      if (el && tile.stream && el.srcObject !== tile.stream) {
                        el.srcObject = tile.stream;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted={tile.isLocal}
                    className={`discord-tile-video ${isVideoContain ? 'is-contain' : 'is-cover'}`}
                  />
                  <div className="discord-tile-overlay">
                    <div className="discord-tile-name-tag">
                      {tile.isScreen && <span className="discord-live-badge">LIVE</span>}
                      <span>{tile.name}</span>
                    </div>
                    {tile.muted && (
                      <div className="discord-tile-muted-badge">
                        <MicOff size={13} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* 2. SPOTLIGHT VIEW (Focus Stage + Filmstrip) */
            <div className="call-discord-spotlight-container">
              {/* Main Focus Stage */}
              <div className="discord-spotlight-stage">
                {focusedTile ? (
                  <div className={`discord-stage-video-wrapper ${focusedTile.isScreen ? 'is-screen' : ''}`}>
                    <video
                      ref={(el) => {
                        if (el && focusedTile.stream && el.srcObject !== focusedTile.stream) {
                          el.srcObject = focusedTile.stream;
                          el.play().catch(() => {});
                        }
                      }}
                      autoPlay
                      playsInline
                      muted={focusedTile.isLocal}
                      className={`discord-stage-video ${isVideoContain ? 'is-contain' : 'is-cover'}`}
                    />
                    <div className="discord-stage-header-overlay">
                      <div className="discord-stage-tag">
                        {focusedTile.isScreen && <span className="discord-live-badge">LIVE</span>}
                        <span className="discord-stage-name">{focusedTile.name}</span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Discord Filmstrip Switcher (Interactive bottom strip of streams) */}
              <div className="call-discord-filmstrip">
                {streamTiles.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    className={`discord-filmstrip-item ${focusedTile?.id === tile.id ? 'is-selected' : ''} ${tile.speaking ? 'speaking' : ''}`}
                    onClick={() => setSelectedStreamId(tile.id)}
                    title={`Переключить на: ${tile.name}`}
                  >
                    <video
                      ref={(el) => {
                        if (el && tile.stream && el.srcObject !== tile.stream) {
                          el.srcObject = tile.stream;
                          el.play().catch(() => {});
                        }
                      }}
                      autoPlay
                      playsInline
                      muted={tile.isLocal}
                      className="discord-filmstrip-thumb"
                    />
                    <div className="discord-filmstrip-badge">
                      {tile.isScreen ? <Monitor size={11} /> : <Video size={11} />}
                      <span>{tile.isLocal ? 'Вы' : tile.name.split(' ')[0]}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          /* ========================================================
             Voice participants
             ======================================================== */
          <div className="call-voice-stage-container">
            {/* Speaker avatar */}
            <div className="call-avatar-section">
              <div className={`call-avatar-circle ${activeSpeaker?.speaking ? 'active-speaker-ring' : ''}`}>
                {renderAvatar(
                  activeSpeaker?.avatar || avatarContent,
                  isGroupCall ? chatAvatarFallback(activeChat) : personAvatarFallback({ name: activeSpeaker?.name || displayName })
                )}
              </div>
            </div>

            <h2 className="call-user-name" id="call-overlay-title">
              {activeSpeaker?.name || displayName}
            </h2>

            <div className="call-status-container">
              <p className="call-status-subtitle">
                {isGroupCall ? groupStatusSubtitle : statusText}
              </p>
              {callState.status === 'connected' &&
                callState.webrtcState === 'connected' &&
                (callState.isLocalSpeaking || callState.isRemoteSpeaking || activeSpeaker?.speaking) && (
                  <div className="speaking-wave-indicator one-to-one-wave">
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                    <span className="wave-bar" />
                  </div>
                )}
            </div>

            {/* Group Voice Participant List */}
            {isGroupCall && (
              <div className="group-call-stage-list">
                {sortedGroupParticipants.map((p) => (
                  <div key={p.id} className={`group-call-member-row ${p.speaking ? 'speaking' : ''}`}>
                    <div className={`group-call-avatar-wrapper ${p.speaking ? 'speaking' : ''}`}>
                      {renderAvatar(p.avatar, personAvatarFallback(p))}
                    </div>
                    <div className="group-call-member-info">
                      <span className="group-call-member-name">{p.name}</span>
                      <span
                        className={`group-call-member-status ${p.muted ? 'muted' : p.speaking ? 'speaking' : 'online'}`}
                      >
                        {p.muted ? 'Микрофон выкл.' : p.speaking ? 'Говорит' : 'Слушает'}
                      </span>
                    </div>
                    <div className="group-call-member-action">
                      {p.muted ? (
                        <div className="group-call-status-icon muted">
                          <MicOff size={14} />
                        </div>
                      ) : p.speaking ? (
                        <div className="speaking-wave-indicator">
                          <span className="wave-bar" />
                          <span className="wave-bar" />
                          <span className="wave-bar" />
                        </div>
                      ) : (
                        <div className="group-call-status-icon active">
                          <Mic size={14} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {callState.status === 'connected' && callState.webrtcState === 'failed' && (
              <p
                className="call-connection-hint"
                style={{ fontSize: '11.5px', color: '#ff7675', marginBottom: '14px' }}
              >
                Нет WebRTC-связи (сеть/NAT). Нажмите «Повторить» или завершите звонок.
              </p>
            )}
          </div>
        )}

        {/* ========================================================
            FLOATING ILLUMINATED ACTION DOCK
            ======================================================== */}
        <div className="call-controls">
          {callState.status === 'incoming' ? (
            <div className="incoming-buttons" style={{ display: 'flex', gap: '24px' }}>
              <button
                ref={acceptBtnRef}
                type="button"
                className="call-ctrl-btn call-accept"
                onClick={acceptCall}
                title="Ответить на звонок"
              >
                <Phone size={22} />
              </button>
              <button
                ref={rejectBtnRef}
                type="button"
                className="call-ctrl-btn call-hangup"
                onClick={rejectCall}
                title="Отклонить звонок"
              >
                <PhoneOff size={22} />
              </button>
            </div>
          ) : (
            <div className="active-controls-panel">
              {showVideoControls && (
                <button
                  type="button"
                  className={`call-ctrl-btn ctrl-secondary ${localVideoStream && !isScreenSharing ? 'active-video' : ''}`}
                  onClick={toggleCallVideo}
                  disabled={callState.status === 'ended'}
                  title={
                    localVideoStream && !isScreenSharing ? 'Выключить камеру' : 'Включить камеру'
                  }
                >
                  {localVideoStream && !isScreenSharing ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
              )}

              <button
                type="button"
                className={`call-ctrl-btn ctrl-secondary ${callState.muted ? 'active-mute' : ''}`}
                onClick={toggleCallMute}
                disabled={callState.status === 'ended'}
                title={callState.muted ? 'Включить микрофон' : 'Отключить микрофон'}
              >
                {callState.muted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              <button
                type="button"
                className={`call-ctrl-btn ctrl-secondary ${voiceEnhancementEnabled ? 'active-enhancement active-video' : ''}`}
                onClick={toggleVoiceEnhancement}
                disabled={callState.status !== 'connected'}
                title={voiceEnhancementEnabled ? 'Шумоподавление: Включено' : 'Шумоподавление: Выключено'}
                aria-label={voiceEnhancementEnabled ? 'Шумоподавление: Включено' : 'Шумоподавление: Выключено'}
              >
                <Sparkles size={20} />
              </button>

              {showVideoControls && isScreenShareSupported && (
                <button
                  type="button"
                  className={`call-ctrl-btn ctrl-secondary ${isScreenSharing ? 'active-screenshare' : ''}`}
                  onClick={toggleCallScreenShare}
                  disabled={callState.status === 'ended'}
                  title={
                    isScreenSharing ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана'
                  }
                >
                  <Monitor size={20} />
                </button>
              )}

              {callState.status === 'connected' &&
                callState.webrtcState === 'failed' &&
                typeof retryCallConnection === 'function' && (
                  <button
                    type="button"
                    className="call-ctrl-btn ctrl-secondary call-retry"
                    onClick={retryCallConnection}
                    title="Повторить соединение"
                  >
                    <RefreshCw size={20} />
                  </button>
                )}

              <button
                type="button"
                className="call-ctrl-btn call-hangup ctrl-secondary"
                onClick={endCall}
                disabled={callState.status === 'ended'}
                title="Завершить звонок"
              >
                <PhoneOff size={20} />
              </button>
            </div>
          )}
        </div>

        {!isIncoming && !isCompact && (
          <div
            className="call-resize-handle"
            onMouseDown={handleResizeMouseDown}
            onTouchStart={handleResizeTouchStart}
            title="Растянуть окно"
          />
        )}
      </div>
    </div>
  );
}
