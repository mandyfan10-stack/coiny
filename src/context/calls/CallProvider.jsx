import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useChat } from '../ChatContext';
import { dataService } from '../../services/dataLayer';
import { useCallSignaling } from './useCallSignaling';
import { CALL_INVITATION_TTL_MS } from './callInvitationDelivery';
import { useCallMedia } from './useCallMedia';
import { useE2EE } from '../E2EEContext';
import { VoiceEnhancementPipeline } from './voiceEnhancement';
import { useCallTransport } from './useCallTransport';

export const CallContext = createContext();

/** Outgoing/incoming ring auto-end (C8). */
export const CALL_RING_TIMEOUT_MS = 60_000;

const IDLE_CALL_STATE = {
  status: 'idle',
  chatId: null,
  duration: 0,
  muted: false,
  isOutgoing: false,
  callerInfo: null,
  otherUserId: null,
  webrtcState: 'disconnected',
  isRemoteScreenSharing: false,
  isLocalSpeaking: false,
  isRemoteSpeaking: false
};

const BUSY_CALL_STATUSES = new Set(['calling', 'incoming', 'connected']);

export const CallProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const { chats } = useChat();
  const { encryptEvent, decryptEvent } = useE2EE();

  const [callState, setCallState] = useState(() => ({ ...IDLE_CALL_STATE }));

  const [groupCallParticipants, setGroupCallParticipants] = useState([]);
  const groupCallTimersRef = useRef([]);
  const pcsRef = useRef({});
  const candidateQueuesRef = useRef({});
  const audioAnalyzersRef = useRef({});
  const endCallLocallyRef = useRef(() => {});
  const peerSessionsRef = useRef(new Map());
  const mediaGenerationRef = useRef(0);
  const videoRevisionRef = useRef(0);
  const [callQuality, setCallQuality] = useState({ peers: [] });

  const [localVideoStream, setLocalVideoStream] = useState(null);
  const [remoteVideoStream, setRemoteVideoStream] = useState(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  /** V5: in-overlay media permission / capture errors (no window.alert). */
  const [mediaError, setMediaError] = useState(null);
  const [voiceEnhancementEnabled, setVoiceEnhancementEnabled] = useState(false);
  const voiceEnhancementRef = useRef(new VoiceEnhancementPipeline());
  const screenStreamRef = useRef(null);
  const wasCameraActiveRef = useRef(false);

  const localStreamRef = useRef(null);
  const localVideoStreamRef = useRef(null);
  const pcRef = useRef(null);
  const activeCallChannelRef = useRef(null);
  const endingSignalingRef = useRef(null);

  const callChat = chats.find(c => c.id === callState.chatId);
  const signalingChannelKey = chats
    .map(chat => `${chat.id}:${chat.cryptoVersion ?? 1}`)
    .sort()
    .join(',');
  const currentUserRef = useRef(currentUser);
  const callChatRef = useRef(callChat);
  const callStateRef = useRef(callState);
  currentUserRef.current = currentUser;
  callChatRef.current = callChat;
  callStateRef.current = callState;

  /** Shared media/PC teardown used by hangup, reject, remote end, and effect cleanup (C4). */
  const teardownMedia = useCallback(() => {
    mediaGenerationRef.current += 1;
    videoRevisionRef.current = 0;
    for (const session of peerSessionsRef.current.values()) session.dispose();
    peerSessionsRef.current.clear();
    voiceEnhancementRef.current.dispose(pcRef.current, pcsRef.current);
    setVoiceEnhancementEnabled(false);
    if (groupCallTimersRef.current) {
      groupCallTimersRef.current.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      });
      groupCallTimersRef.current = [];
    }
    setGroupCallParticipants([]);

    Object.keys(pcsRef.current).forEach((peerId) => {
      try {
        pcsRef.current[peerId]?.close();
      } catch {
        /* ignore */
      }
    });
    pcsRef.current = {};

    Object.keys(audioAnalyzersRef.current).forEach((key) => {
      try {
        audioAnalyzersRef.current[key]?.stop?.();
      } catch {
        /* ignore */
      }
    });
    audioAnalyzersRef.current = {};

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach((track) => track.stop());
      localVideoStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    setLocalVideoStream(null);
    setRemoteVideoStream(null);
    wasCameraActiveRef.current = false;
    candidateQueuesRef.current = {};

    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* ignore */
      }
      pcRef.current = null;
    }
    if (activeCallChannelRef.current) {
      const channel = activeCallChannelRef.current;
      const ending = endingSignalingRef.current;
      try {
        if (ending?.channel === channel) {
          // Stop media immediately, while allowing the encrypted terminal
          // message a bounded time to leave the still-subscribed channel.
          const timer = setTimeout(() => { void channel.unsubscribe(); }, Math.max(0, ending.expiresAt - Date.now()));
          void ending.promise.catch(() => undefined).finally(() => {
            clearTimeout(timer);
            void channel.unsubscribe();
            if (endingSignalingRef.current === ending) endingSignalingRef.current = null;
          });
        } else channel.unsubscribe();
      } catch {
        /* ignore */
      }
      activeCallChannelRef.current = null;
    }
    document.querySelectorAll('.webrtc-remote-audio-feed').forEach((el) => {
      el.srcObject = null;
      el.remove();
    });
  }, []);

  const endCallLocally = useCallback(() => {
    teardownMedia();
    setCallState((prev) => {
      if (prev.status === 'idle') return prev;
      return { ...prev, status: 'ended' };
    });
    // C1: only return to idle if still on the ended flash — never wipe a new call.
    setTimeout(() => {
      setCallState((prev) => (prev.status === 'ended' ? { ...IDLE_CALL_STATE } : prev));
    }, 1500);
  }, [teardownMedia]);

  endCallLocallyRef.current = endCallLocally;

  useEffect(() => {
    teardownMedia();
    setCallState(previous => previous.status === 'idle' ? previous : { ...IDLE_CALL_STATE });
  }, [currentUser?.id, teardownMedia]);

  // Profile clones keep their transport. Losing the active chat or membership
  // is different: a previously authorised audio path must close immediately.
  const callMembership = callChat?.members?.some(member => member.id === currentUser?.id || member.id === 'current');
  const activeChatExists = Boolean(callChat);
  const isGroupCall = callChat?.type === 'group';
  useEffect(() => {
    if (!BUSY_CALL_STATUSES.has(callState.status) || !callState.chatId) return;
    if (!activeChatExists || (isGroupCall && !callMembership)) endCallLocally();
  }, [activeChatExists, isGroupCall, callMembership, callState.status, callState.chatId, endCallLocally]);

  const { sendSignalingMessage } = useCallSignaling({
    currentUser,
    chats,
    signalingChannelKey,
    callState,
    setCallState,
    onRemoteEnd: () => endCallLocallyRef.current(),
    encryptEvent,
    decryptEvent
  });

  // C8: auto-end unanswered outgoing / missed incoming after ring timeout.
  useEffect(() => {
    if (callState.status !== 'calling' && callState.status !== 'incoming') return undefined;
    const statusAtStart = callState.status;
    const timer = setTimeout(() => {
      if (callStateRef.current.status !== statusAtStart) return;
      if (dataService.isLive() && callStateRef.current.chatId) {
        sendSignalingMessage(callStateRef.current.chatId, 'call-rejected', {
          callId: callStateRef.current.callId, senderId: currentUserRef.current?.id
        });
      }
      endCallLocally();
    }, CALL_RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState.status, endCallLocally, sendSignalingMessage]);

  useCallTransport({
    status: callState.status, callId: callState.callId, userId: currentUser?.id,
    callChatRef, callStateRef, currentUserRef, encryptEvent, decryptEvent,
    peerSessionsRef, pcRef, pcsRef, localStreamRef, localVideoStreamRef, screenStreamRef, videoRevisionRef,
    activeCallChannelRef, audioAnalyzersRef, endingSignalingRef,
    setCallState, setGroupCallParticipants, setRemoteVideoStream, setMediaError,
    setCallQuality, teardownMedia, endCallLocally
  });

  const startCall = useCallback((chatId) => {
    if (!currentUser) return;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    // Do not start a second call while busy (pairs with C2 busy incoming).
    if (BUSY_CALL_STATUSES.has(callStateRef.current.status)) return;

    setMediaError(null);
    const otherMember = chat.members.find(m => m.id !== currentUser.id && m.id !== 'current');
    const otherUserId = chat.type === 'personal' ? (otherMember ? otherMember.id : null) : null;
    const isGroup = chat.type === 'group';
    const callId = crypto.randomUUID();
    const expiresAt = Date.now() + CALL_INVITATION_TTL_MS;

    setCallState({
      status: isGroup ? 'connected' : 'calling',
      ownerId: currentUser.id,
      chatId,
      callId,
      expiresAt,
      duration: 0,
      muted: false,
      isOutgoing: true,
      otherUserId,
      callerInfo: null,
      webrtcState: isGroup ? 'connected' : 'disconnected',
      isRemoteScreenSharing: false,
      isLocalSpeaking: false,
      isRemoteSpeaking: false
    });

    if (isGroup) {
      setGroupCallParticipants([
        {
          id: currentUser.id || 'current',
          name: 'Вы',
          avatar: currentUser.avatar || '🪙',
          avatarColor: currentUser.avatarColor,
          muted: false,
          videoStream: null,
          speaking: false
        }
      ]);

      if (!dataService.isLive()) {
        const timers = [];
        const speakInterval = setInterval(() => {
          setGroupCallParticipants(prev => {
            return prev.map(p => {
              const isMe = p.id === (currentUser?.id || 'current');
              if (isMe) {
                return { ...p, speaking: !p.muted && Math.random() > 0.65 };
              }
              if (p.isReal) return p;
              return !p.muted ? { ...p, speaking: Math.random() > 0.65 } : { ...p, speaking: false };
            });
          });
        }, 1500);
        timers.push(speakInterval);
        groupCallTimersRef.current = timers;
      }
    }

    if (dataService.isLive()) {
      if (chat.type === 'personal' && otherUserId) {
        sendSignalingMessage(chatId, 'incoming-call', {
          callId, expiresAt,
          callerId: currentUser.id,
          callerName: currentUser.name || currentUser.username || 'Пользователь',
          callerAvatar: currentUser.avatar,
          callerAvatarColor: currentUser.avatarColor,
          chatId
        });
      } else if (isGroup) {
        sendSignalingMessage(chatId, 'incoming-call', {
          callId, expiresAt,
          callerId: currentUser.id,
          callerName: chat.name || 'Группа',
          callerAvatar: chat.avatar,
          callerAvatarColor: chat.avatarColor || chat.avatar_color,
          chatId
        });
      }
    } else if (!isGroup) {
      setTimeout(() => {
        setCallState(prev => {
          if (prev.status === 'calling') {
            return { ...prev, status: 'connected', webrtcState: 'connected' };
          }
          return prev;
        });
      }, 3000);
    }
  }, [currentUser, chats, sendSignalingMessage]);

  const acceptCall = useCallback(() => {
    setMediaError(null);
    const chat = chats.find(c => c.id === callState.chatId);
    const isGroup = chat && chat.type === 'group';

    if (isGroup) {
      setGroupCallParticipants([
        {
          id: currentUser.id || 'current',
          name: 'Вы',
          avatar: currentUser.avatar || '👤',
          avatarColor: currentUser.avatar_color || currentUser.avatarColor,
          muted: false,
          videoStream: null,
          speaking: false
        }
      ]);
    }

    if (dataService.isLive() && callState.otherUserId) {
      sendSignalingMessage(callState.chatId, 'call-accepted', { responderId: currentUser.id, callId: callState.callId });
    }
    setCallState(prev => ({
      ...prev,
      status: 'connected',
      webrtcState: dataService.isLive() ? 'connecting' : 'connected'
    }));

    if (!dataService.isLive()) {
      setTimeout(() => {
        setCallState(prev => prev.status === 'connected' ? { ...prev, webrtcState: 'connected' } : prev);
      }, 1500);
    }
  }, [callState.chatId, callState.otherUserId, callState.callId, currentUser, chats, sendSignalingMessage]);

  const rejectCall = useCallback(() => {
    if (dataService.isLive() && callState.otherUserId) {
      sendSignalingMessage(callState.chatId, 'call-rejected', { callId: callState.callId, senderId: currentUser.id });
    }
    endCallLocally();
  }, [callState.chatId, callState.otherUserId, callState.callId, currentUser, endCallLocally, sendSignalingMessage]);

  const endCall = useCallback(() => {
    if (dataService.isLive()) {
      // The peer may still be ringing if its acceptance was lost, and therefore
      // has not subscribed to media yet. End both establishment and media.
      if (callState.chatId) sendSignalingMessage(callState.chatId, 'call-rejected', {
        callId: callState.callId, senderId: currentUser?.id,
        callerId: callState.isOutgoing ? currentUser?.id : callState.otherUserId
      });
      if (activeCallChannelRef.current) {
        const channel = activeCallChannelRef.current;
        const ending = { channel, callId: callState.callId, userId: currentUser?.id,
          expiresAt: Date.now() + 3_000, promise: Promise.resolve() };
        endingSignalingRef.current = ending;
        ending.promise = channel.send({
          type: 'broadcast',
          event: 'hangup',
          payload: { senderId: currentUser?.id, callId: callState.callId }
        });
        void ending.promise.catch(() => undefined);
      }
    }
    endCallLocally();
  }, [callState.chatId, callState.otherUserId, callState.callId, callState.isOutgoing, endCallLocally, currentUser, sendSignalingMessage]);

  const retryCallConnection = useCallback(async () => {
    await Promise.all([...peerSessionsRef.current.values()].map(session => session.recover({ force: true })));
  }, []);

  const renegotiateMedia = useCallback(async () => {
    await Promise.all([...peerSessionsRef.current.values()].map(session => session.negotiate()));
  }, []);

  const toggleCallMute = useCallback(() => {
    const nextMuted = !callState.muted;
    voiceEnhancementRef.current.setMuted(nextMuted);
    setCallState(prev => ({ ...prev, muted: nextMuted }));

    setGroupCallParticipants(prev => prev.map(p => {
      const isMe = p.id === (currentUser?.id || 'current');
      return isMe ? { ...p, muted: nextMuted, speaking: nextMuted ? false : p.speaking } : p;
    }));

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !nextMuted;
      });
    }

    const isGroup = chats.find(chat => chat.id === callState.chatId)?.type === 'group';
    if (isGroup && activeCallChannelRef.current) {
      activeCallChannelRef.current.track({
        id: currentUser.id,
        sessionId: callState.callId,
        name: currentUser.name || currentUser.username || 'Пользователь',
        avatar: currentUser.avatar || '🪙',
        avatarColor: currentUser.avatarColor || currentUser.avatar_color,
        muted: nextMuted
      }).catch(error => console.error('Failed to update group call presence:', error));
    }
  }, [callState.chatId, callState.callId, callState.muted, chats, currentUser]);

  const toggleVoiceEnhancement = useCallback(async () => {
    if (callState.status !== 'connected' || !localStreamRef.current) return;
    try {
      if (voiceEnhancementRef.current.active) {
        await voiceEnhancementRef.current.disable(pcRef.current, pcsRef.current);
        setVoiceEnhancementEnabled(voiceEnhancementRef.current.active);
      } else {
        await voiceEnhancementRef.current.enable(localStreamRef.current, pcRef.current, pcsRef.current);
        setVoiceEnhancementEnabled(voiceEnhancementRef.current.active);
      }
      setMediaError(null);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Voice enhancement failed:', error);
      setVoiceEnhancementEnabled(voiceEnhancementRef.current.active);
      setMediaError('Не удалось переключить улучшение голоса.');
    }
  }, [callState.status]);

  const {
    toggleCallVideo,
    toggleCallScreenShare
  } = useCallMedia({
    mediaGenerationRef,
    videoRevisionRef,
    callStateRef,
    callState,
    chats,
    currentUser,
    localVideoStream,
    setLocalVideoStream,
    isScreenSharing,
    setIsScreenSharing,
    localVideoStreamRef,
    screenStreamRef,
    wasCameraActiveRef,
    pcRef,
    pcsRef,
    activeCallChannelRef,
    setMediaError,
    renegotiateMedia
  });

  const clearMediaError = useCallback(() => setMediaError(null), []);

  return (
    <CallContext.Provider value={{
      callState,
      setCallState,
      startCall,
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
      setGroupCallParticipants,
      mediaError,
      clearMediaError,
      voiceEnhancementEnabled,
      callQuality,
      toggleVoiceEnhancement
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCalls = () => useContext(CallContext);
