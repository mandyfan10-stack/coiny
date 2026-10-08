import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useChat } from '../ChatContext';
import { supabase } from '../../supabaseClient';
import { dataService } from '../../services/dataLayer';
import { startAudioAnalyzer } from './audioAnalyzer';
import { createPeerConnection, refreshIceConfiguration } from './iceServers';
import { isScreenTrack, attachRemoteAudioElement } from './mediaTrackHelpers';
import { useCallSignaling } from './useCallSignaling';
import { useCallMedia } from './useCallMedia';
import { useE2EE } from '../E2EEContext';
import { secureCallChannel } from './secureCallChannel';
import { CALL_AUDIO_CONSTRAINTS, VoiceEnhancementPipeline } from './voiceEnhancement';

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
  const retryCallConnectionRef = useRef(() => {});

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
      try {
        activeCallChannelRef.current.unsubscribe();
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

  const { sendSignalingMessage } = useCallSignaling({
    currentUser,
    chats,
    signalingChannelKey,
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
        sendSignalingMessage(callStateRef.current.chatId, 'call-rejected', {});
      }
      endCallLocally();
    }, CALL_RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [callState.status, endCallLocally, sendSignalingMessage]);

  // WebRTC Connection and Streaming Effect
  useEffect(() => {
    let cancelled = false;
    let activeCallChannel = null;
    let localStream = null;
    let pc = null;
    const candidateQueue = [];

    const processCandidateQueue = async () => {
      if (!pc || cancelled) return;
      console.log(`Processing ICE candidate queue (${candidateQueue.length} items)...`);
      while (candidateQueue.length > 0) {
        const candidate = candidateQueue.shift();
        try {
          await pc.addIceCandidate(candidate);
          console.log("Successfully added queued ICE candidate:", candidate.candidate);
        } catch (e) {
          console.error("Error adding queued ICE candidate:", e);
        }
      }
    };

    const initWebRTC = async () => {
      if (callStateRef.current.status !== 'connected' || cancelled) return;

      console.log("Initializing WebRTC call...");

      try {
        await refreshIceConfiguration({ allowDirectConnection: true });
        localStream = await navigator.mediaDevices.getUserMedia({ audio: CALL_AUDIO_CONSTRAINTS });
        if (cancelled || callStateRef.current.status !== 'connected') {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        localStreamRef.current = localStream;
        console.log("Local audio stream captured successfully.");

        if (audioAnalyzersRef.current['local']) {
          audioAnalyzersRef.current['local'].stop();
        }
        const localAnalyzer = startAudioAnalyzer(localStream, (isSpeaking) => {
          setCallState(prev => {
            if (prev.isLocalSpeaking !== isSpeaking) {
              return { ...prev, isLocalSpeaking: isSpeaking };
            }
            return prev;
          });
          setGroupCallParticipants(prev => prev.map(p => {
            const isMe = p.id === (currentUserRef.current?.id || 'current');
            if (isMe) {
              return { ...p, speaking: isSpeaking };
            }
            return p;
          }));
        });
        audioAnalyzersRef.current['local'] = localAnalyzer;
      } catch (err) {
        console.error("Failed to capture local audio:", err);
        setMediaError('Не удалось получить доступ к микрофону. Проверьте разрешения браузера.');
        endCallLocally();
        return;
      }

      pc = createPeerConnection();
      pcRef.current = pc;

      const handle1to1StateChange = () => {
        const iceState = pc.iceConnectionState;
        const connState = pc.connectionState;
        console.log(`[WebRTC Telemetry] 1:1 ICE Connection State Changed: ${iceState}`);
        if (iceState === 'connected' || iceState === 'completed' || connState === 'connected') {
          setCallState(prev => ({ ...prev, webrtcState: 'connected' }));
        } else if (iceState === 'failed' || connState === 'failed') {
          setCallState(prev => ({ ...prev, webrtcState: 'failed' }));
          console.error("[WebRTC Telemetry] 1:1 ICE connection failed. Triggering automatic restart...");
          retryCallConnectionRef.current?.().catch(() => {});
        } else if (iceState === 'disconnected') {
          console.warn("[WebRTC Telemetry] 1:1 ICE connection temporarily disconnected, monitoring for recovery...");
          setTimeout(() => {
            if (pcRef.current && (pcRef.current.iceConnectionState === 'disconnected' || pcRef.current.iceConnectionState === 'failed')) {
              console.log("[WebRTC Telemetry] ICE remained disconnected, attempting auto-restart...");
              retryCallConnectionRef.current?.().catch(() => {});
            }
          }, 3000);
        } else if (iceState === 'connecting' || iceState === 'checking' || connState === 'connecting') {
          setCallState(prev => prev.webrtcState === 'connected' ? prev : ({ ...prev, webrtcState: 'connecting' }));
        }
      };

      pc.oniceconnectionstatechange = handle1to1StateChange;
      pc.onconnectionstatechange = handle1to1StateChange;

      pc.onicecandidate = (event) => {
        if (event.candidate && activeCallChannel) {
          activeCallChannel.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'candidate', candidate: event.candidate }
          });
        }
      };

      pc.ontrack = (event) => {
        console.log("Remote WebRTC track received:", event.track.kind);
        setCallState(prev => ({ ...prev, webrtcState: 'connected' }));
        event.track.enabled = true;
        
        if (event.track.kind === 'audio') {
          const audioStream = new MediaStream([event.track]);
          const elementId = `webrtc-audio-${event.track.id}`;
          attachRemoteAudioElement(elementId, audioStream);

          if (audioAnalyzersRef.current['remote']) {
            try {
              audioAnalyzersRef.current['remote'].stop();
            } catch {
              /* ignore */
            }
            delete audioAnalyzersRef.current['remote'];
          }
          const remoteAnalyzer = startAudioAnalyzer(audioStream, (isSpeaking) => {
            setCallState(prev => {
              if (prev.isRemoteSpeaking !== isSpeaking) {
                return { ...prev, isRemoteSpeaking: isSpeaking };
              }
              return prev;
            });
          });
          audioAnalyzersRef.current['remote'] = remoteAnalyzer;

          event.track.onended = () => {
            const el = document.getElementById(elementId);
            if (el) {
              el.srcObject = null;
              el.remove();
            }
            if (audioAnalyzersRef.current['remote']) {
              try {
                audioAnalyzersRef.current['remote'].stop();
              } catch {
                /* ignore */
              }
              delete audioAnalyzersRef.current['remote'];
            }
          };
        } else if (event.track.kind === 'video') {
          const videoStream = event.streams[0] || new MediaStream([event.track]);
          setRemoteVideoStream(videoStream);
          const isScreen = isScreenTrack(event.track);
          setCallState(prev => ({ ...prev, isRemoteScreenSharing: isScreen }));
        }
      };

      localStream.getTracks().forEach(track => {
        track.enabled = true;
        pc.addTrack(track, localStream);
      });

      if (dataService.isLive()) {
        const isGroup = callChatRef.current?.type === 'group';

        if (isGroup) {
          activeCallChannel = secureCallChannel(supabase.channel(`call:chat:${callStateRef.current.chatId}:media`, {
            config: {
              private: true,
              presence: { key: currentUserRef.current.id }
            }
          }), {
            chatId: callStateRef.current.chatId,
            cryptoVersion: callChatRef.current?.cryptoVersion,
            encryptEvent,
            decryptEvent
          });
          activeCallChannelRef.current = activeCallChannel;

          const processPeerCandidateQueue = async (peerId, pcInstance) => {
            const queue = candidateQueuesRef.current[peerId];
            if (!queue || queue.length === 0) return;
            while (queue.length > 0) {
              const candidate = queue.shift();
              try {
                await pcInstance.addIceCandidate(candidate);
              } catch (e) {
                console.error(`Error adding queued ICE candidate for peer ${peerId}:`, e);
              }
            }
          };

          const teardownPeer = (peerId) => {
            if (pcsRef.current[peerId]) {
              try {
                pcsRef.current[peerId].close();
              } catch {
                /* ignore */
              }
              delete pcsRef.current[peerId];
            }
            delete candidateQueuesRef.current[peerId];
            if (audioAnalyzersRef.current[peerId]) {
              try {
                audioAnalyzersRef.current[peerId].stop();
              } catch {
                /* ignore */
              }
              delete audioAnalyzersRef.current[peerId];
            }
            document.querySelectorAll(`[id^="webrtc-audio-${peerId}-"]`).forEach(el => {
              el.srcObject = null;
              el.remove();
            });
            setGroupCallParticipants(prev => prev.filter(p => p.id !== peerId));
          };

          const ensureGroupParticipant = (peerId) => {
            const memberInfo = callChatRef.current?.members?.find(member => member.id === peerId);
            setGroupCallParticipants(previous => {
              if (previous.some(participant => participant.id === peerId)) {
                return previous.map(participant => (
                  participant.id === peerId ? { ...participant, isReal: true } : participant
                ));
              }
              return [...previous, {
                id: peerId,
                name: memberInfo ? memberInfo.name : `Пользователь ${peerId.slice(0, 4)}`,
                avatar: memberInfo ? memberInfo.avatar : '👤',
                avatarColor: (memberInfo && (memberInfo.avatarColor || memberInfo.avatar_color))
                  || 'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
                muted: false,
                videoStream: null,
                speaking: false,
                isReal: true
              }];
            });
          };
          const getOrCreatePeerConnection = (peerId) => {
            if (pcsRef.current[peerId]) {
              return pcsRef.current[peerId];
            }
            const pcInstance = createPeerConnection();

            const handleGroupPeerStateChange = () => {
              const iceState = pcInstance.iceConnectionState;
              const connState = pcInstance.connectionState;
              console.log(`[WebRTC Telemetry] Group ICE Connection State Changed for peer ${peerId}: ${iceState}`);
              if (iceState === 'connected' || iceState === 'completed' || connState === 'connected') {
                setCallState(prev => ({ ...prev, webrtcState: 'connected' }));
              } else if (iceState === 'failed' || connState === 'failed') {
                console.error(`[WebRTC Telemetry] Group ICE connection failed for peer ${peerId}. Triggering restart...`);
                retryCallConnectionRef.current?.().catch(() => {});
              } else if (iceState === 'disconnected') {
                console.warn(`[WebRTC Telemetry] Group ICE connection disconnected for peer ${peerId}.`);
                setTimeout(() => {
                  if (pcInstance && (pcInstance.iceConnectionState === 'disconnected' || pcInstance.iceConnectionState === 'failed')) {
                    retryCallConnectionRef.current?.().catch(() => {});
                  }
                }, 3000);
              } else if (iceState === 'connecting' || iceState === 'checking' || connState === 'connecting') {
                setCallState(prev => prev.webrtcState === 'connected' ? prev : ({ ...prev, webrtcState: 'connecting' }));
              }
            };

            pcInstance.oniceconnectionstatechange = handleGroupPeerStateChange;
            pcInstance.onconnectionstatechange = handleGroupPeerStateChange;

            pcInstance.onicecandidate = (event) => {
              if (event.candidate && activeCallChannel) {
                activeCallChannel.send({
                  type: 'broadcast',
                  event: 'signal',
                  payload: {
                    type: 'candidate',
                    candidate: event.candidate,
                    senderId: currentUserRef.current.id,
                    targetId: peerId
                  }
                });
              }
            };

            pcInstance.ontrack = (event) => {
              setCallState(prev => ({ ...prev, webrtcState: 'connected' }));
              event.track.enabled = true;
              
              if (event.track.kind === 'audio') {
                const audioStream = new MediaStream([event.track]);
                const elementId = `webrtc-audio-${peerId}-${event.track.id}`;
                attachRemoteAudioElement(elementId, audioStream);

                if (audioAnalyzersRef.current[peerId]) {
                  try {
                    audioAnalyzersRef.current[peerId].stop();
                  } catch {
                    /* ignore */
                  }
                  delete audioAnalyzersRef.current[peerId];
                }
                const analyzer = startAudioAnalyzer(audioStream, (isSpeaking) => {
                  setGroupCallParticipants(prev => prev.map(p => {
                    if (p.id === peerId) {
                      return { ...p, speaking: isSpeaking };
                    }
                    return p;
                  }));
                });
                audioAnalyzersRef.current[peerId] = analyzer;

                event.track.onended = () => {
                  const el = document.getElementById(elementId);
                  if (el) {
                    el.srcObject = null;
                    el.remove();
                  }
                  if (audioAnalyzersRef.current[peerId]) {
                    try {
                      audioAnalyzersRef.current[peerId].stop();
                    } catch {
                      /* ignore */
                    }
                    delete audioAnalyzersRef.current[peerId];
                  }
                };
              } else if (event.track.kind === 'video') {
                // group UI is voice-stage only fallback when no video active (C6).
                event.track.enabled = true;
                const videoStream = new MediaStream([event.track]);
                const isScreen = isScreenTrack(event.track);
                setGroupCallParticipants((prev) =>
                  prev.map((p) => {
                    if (p.id === peerId) {
                      return {
                        ...p,
                        videoStream,
                        cameraStream: !isScreen ? videoStream : p.cameraStream,
                        screenStream: isScreen ? videoStream : p.screenStream,
                        isCameraActive: !isScreen ? true : p.isCameraActive,
                        isScreenSharing: isScreen ? true : p.isScreenSharing
                      };
                    }
                    return p;
                  })
                );

                event.track.onended = () => {
                  setGroupCallParticipants((prev) =>
                    prev.map((p) => {
                      if (p.id === peerId) {
                        return {
                          ...p,
                          videoStream: isScreen ? p.cameraStream : p.screenStream,
                          cameraStream: !isScreen ? null : p.cameraStream,
                          screenStream: isScreen ? null : p.screenStream,
                          isCameraActive: !isScreen ? false : p.isCameraActive,
                          isScreenSharing: isScreen ? false : p.isScreenSharing
                        };
                      }
                      return p;
                    })
                  );
                };
              }
            };

            if (localStream) {
              localStream.getTracks().forEach(track => {
                pcInstance.addTrack(track, localStream);
              });
            }
            // Keep mesh video track attach for renegotiation contracts; UI still audio-only (C6).
            const activeVideoStream = localVideoStreamRef.current;
            if (activeVideoStream) {
              activeVideoStream.getVideoTracks()
                .filter(track => track.readyState === 'live')
                .forEach(track => pcInstance.addTrack(track, activeVideoStream));
            }

            pcsRef.current[peerId] = pcInstance;
            return pcInstance;
          };

          activeCallChannel
            .on('presence', { event: 'sync' }, () => {
              const presenceState = activeCallChannel.presenceState();
              const syncedParticipants = new Map();

              Object.values(presenceState).flat().forEach(presence => {
                if (!presence?.id) return;
                const memberInfo = callChatRef.current?.members?.find(member => member.id === presence.id);
                syncedParticipants.set(presence.id, {
                  id: presence.id,
                  name: presence.id === currentUserRef.current.id
                    ? 'Вы'
                    : presence.name || memberInfo?.name || `Пользователь ${presence.id.slice(0, 4)}`,
                  avatar: presence.avatar || memberInfo?.avatar || '👤',
                  avatarColor: presence.avatarColor
                    || memberInfo?.avatarColor
                    || memberInfo?.avatar_color
                    || 'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
                  muted: Boolean(presence.muted),
                  videoStream: null,
                  speaking: false,
                  isReal: true
                });
              });

              // Ensure the local user is always counted in the group call
              if (currentUserRef.current?.id && !syncedParticipants.has(currentUserRef.current.id)) {
                syncedParticipants.set(currentUserRef.current.id, {
                  id: currentUserRef.current.id,
                  name: 'Вы',
                  avatar: currentUserRef.current.avatar || '👤',
                  avatarColor: currentUserRef.current.avatarColor
                    || currentUserRef.current.avatar_color
                    || 'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
                  muted: Boolean(callStateRef.current.muted),
                  videoStream: localVideoStreamRef.current,
                  speaking: Boolean(callStateRef.current.isLocalSpeaking),
                  isReal: true
                });
              }

              // Teardown resources for peers who left presence without hangup message
              Object.keys(pcsRef.current).forEach(peerId => {
                if (!syncedParticipants.has(peerId) && peerId !== currentUserRef.current?.id) {
                  teardownPeer(peerId);
                }
              });
              Object.keys(audioAnalyzersRef.current).forEach(key => {
                if (key !== 'local' && key !== 'remote' && !syncedParticipants.has(key) && key !== currentUserRef.current?.id) {
                  if (audioAnalyzersRef.current[key]) {
                    try { audioAnalyzersRef.current[key].stop(); } catch { /* ignore */ }
                    delete audioAnalyzersRef.current[key];
                  }
                }
              });

              setGroupCallParticipants((previous) =>
                [...syncedParticipants.values()]
                  .map((participant) => {
                    const existing = previous.find((item) => item.id === participant.id);
                    return existing
                      ? {
                          ...participant,
                          speaking: existing.speaking,
                          videoStream: existing.videoStream,
                          cameraStream: existing.cameraStream,
                          screenStream: existing.screenStream,
                          isCameraActive: existing.isCameraActive,
                          isScreenSharing: existing.isScreenSharing
                        }
                      : participant;
                  })
                  .sort((left, right) => Number(right.id === currentUserRef.current.id) - Number(left.id === currentUserRef.current.id))
              );
            })
            .on('broadcast', { event: 'join-group-call' }, async (payload) => {
              const { senderId } = payload.payload;
              if (senderId === currentUserRef.current.id) return;

              ensureGroupParticipant(senderId);
              
              if (pcsRef.current[senderId]) {
                const existingPc = pcsRef.current[senderId];
                if (existingPc.connectionState === 'connected' || existingPc.iceConnectionState === 'connected') {
                  return;
                }
              }
              
              const pcInstance = getOrCreatePeerConnection(senderId);
              try {
                pcInstance.makingOffer = true;
                const offer = await pcInstance.createOffer();
                await pcInstance.setLocalDescription(offer);
                activeCallChannel.send({
                  type: 'broadcast',
                  event: 'signal',
                  payload: {
                    type: 'offer',
                    sdp: offer.sdp,
                    senderId: currentUserRef.current.id,
                    targetId: senderId
                  }
                });
              } catch (err) {
                console.error(`Error generating offer for peer ${senderId}:`, err);
              } finally {
                pcInstance.makingOffer = false;
              }
            })
            .on('broadcast', { event: 'signal' }, async (payload) => {
              const signal = payload.payload;
              if (signal.targetId !== currentUserRef.current.id) return;
              const senderId = signal.senderId;
              if (!senderId) return;
              ensureGroupParticipant(senderId);

              const pcInstance = getOrCreatePeerConnection(senderId);

              if (signal.type === 'offer') {
                const currentUserId = currentUserRef.current?.id || '';
                const isPolite = String(currentUserId) < String(senderId);
                const offerCollision = Boolean(pcInstance.makingOffer) || pcInstance.signalingState !== 'stable';

                if (offerCollision) {
                  if (!isPolite) {
                    console.log(`[PerfectNegotiation] Glare detected with peer ${senderId}: impolite peer ignoring offer`);
                    return;
                  }
                  console.log(`[PerfectNegotiation] Glare detected with peer ${senderId}: polite peer rolling back local offer`);
                  try {
                    await pcInstance.setLocalDescription({ type: 'rollback' });
                  } catch (rollbackErr) {
                    console.warn(`[PerfectNegotiation] Rollback failed for peer ${senderId}:`, rollbackErr);
                  }
                }

                try {
                  await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
                  const answer = await pcInstance.createAnswer();
                  await pcInstance.setLocalDescription(answer);
                  activeCallChannel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: {
                      type: 'answer',
                      sdp: answer.sdp,
                      senderId: currentUserRef.current.id,
                      targetId: senderId
                    }
                  });
                  await processPeerCandidateQueue(senderId, pcInstance);
                } catch (e) {
                  console.error(`Error handshaking offer from peer ${senderId}:`, e);
                }
              } else if (signal.type === 'answer') {
                try {
                  await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                  await processPeerCandidateQueue(senderId, pcInstance);
                } catch (e) {
                  console.error(`Error setting answer from peer ${senderId}:`, e);
                }
              } else if (signal.type === 'candidate') {
                try {
                  const iceCandidate = new RTCIceCandidate(signal.candidate);
                  if (pcInstance.remoteDescription && pcInstance.remoteDescription.type) {
                    await pcInstance.addIceCandidate(iceCandidate);
                  } else {
                    candidateQueuesRef.current[senderId] = candidateQueuesRef.current[senderId] || [];
                    candidateQueuesRef.current[senderId].push(iceCandidate);
                  }
                } catch (e) {
                  console.error(`Error adding ICE candidate from peer ${senderId}:`, e);
                }
              }
            })
            .on('broadcast', { event: 'hangup' }, (payload) => {
              const { senderId } = payload.payload || {};
              if (senderId) {
                teardownPeer(senderId);
              }
            })
            .subscribe(async (status) => {
              if (status === 'SUBSCRIBED') {
                await activeCallChannel.track({
                  id: currentUserRef.current.id,
                  name: currentUserRef.current.name || currentUserRef.current.username || 'Пользователь',
                  avatar: currentUserRef.current.avatar || '🪙',
                  avatarColor: currentUserRef.current.avatarColor || currentUserRef.current.avatar_color,
                  muted: callStateRef.current.muted
                });
                await activeCallChannel.send({
                  type: 'broadcast',
                  event: 'join-group-call',
                  payload: { senderId: currentUserRef.current.id }
                });
              }
            });
        } else {
          activeCallChannel = secureCallChannel(
            supabase.channel(`call:chat:${callStateRef.current.chatId}:media`, { config: { private: true } }),
            {
              chatId: callStateRef.current.chatId,
              cryptoVersion: callChatRef.current?.cryptoVersion,
              encryptEvent,
              decryptEvent
            }
          );
          activeCallChannelRef.current = activeCallChannel;

          const sendOffer = async () => {
            if (pc.remoteDescription) return;
            if (pc.localDescription) {
              if (activeCallChannel) {
                activeCallChannel.send({
                  type: 'broadcast',
                  event: 'signal',
                  payload: { type: 'offer', sdp: pc.localDescription.sdp }
                });
              }
              return;
            }
            if (pc.signalingState !== 'stable') return;
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              activeCallChannel.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type: 'offer', sdp: offer.sdp }
              });
            } catch (err) {
              console.error("Error generating offer:", err);
            }
          };

          activeCallChannel
            .on('broadcast', { event: 'signal' }, async (payload) => {
              const signal = payload.payload;
              const isInitialSignal = ['ready', 'offer', 'answer'].includes(signal.type);
              if (isInitialSignal && pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected')) {
                return;
              }

              if (signal.type === 'ready' && callStateRef.current.isOutgoing) {
                await sendOffer();
              } else if (signal.type === 'offer' && !callStateRef.current.isOutgoing) {
                try {
                  if (pc && pc.remoteDescription) return;
                  if (pc && pc.signalingState !== 'stable') return;
                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  activeCallChannel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'answer', sdp: answer.sdp }
                  });
                  await processCandidateQueue();
                } catch (e) {
                  console.error("Error setting offer/creating answer:", e);
                }
              } else if (signal.type === 'answer' && callStateRef.current.isOutgoing) {
                try {
                  if (pc && pc.remoteDescription) return;
                  if (pc && pc.signalingState !== 'have-local-offer') return;
                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                  await processCandidateQueue();
                } catch (e) {
                  console.error("Error setting remote answer:", e);
                }
              } else if (signal.type === 'renegotiate-offer') {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  activeCallChannel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'renegotiate-answer', sdp: answer.sdp }
                  });
                  await processCandidateQueue();
                } catch (e) {
                  console.error("Error renegotiating offer:", e);
                }
              } else if (signal.type === 'renegotiate-answer') {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                  await processCandidateQueue();
                } catch (e) {
                  console.error("Error setting renegotiation answer:", e);
                }
              } else if (signal.type === 'video-stopped') {
                setRemoteVideoStream(null);
              } else if (signal.type === 'candidate') {
                try {
                  const iceCandidate = new RTCIceCandidate(signal.candidate);
                  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(iceCandidate);
                  } else {
                    candidateQueue.push(iceCandidate);
                  }
                } catch (e) {
                  console.error("Error adding ice candidate:", e);
                }
              }
            })
            .on('broadcast', { event: 'hangup' }, () => {
              endCallLocally();
            })
            .subscribe(async (status) => {
              if (status === 'SUBSCRIBED') {
                if (callStateRef.current.isOutgoing) {
                  await sendOffer();
                } else {
                  activeCallChannel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: { type: 'ready' }
                  });
                }
              }
            });
        }
      }
    };

    initWebRTC();

    return () => {
      cancelled = true;
      // Full media teardown on leave-connected (C4); idempotent with endCallLocally.
      teardownMedia();
    };
  }, [callState.status, endCallLocally, teardownMedia, encryptEvent, decryptEvent]);

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

    setCallState({
      status: isGroup ? 'connected' : 'calling',
      chatId,
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
          callerId: currentUser.id,
          callerName: currentUser.name || currentUser.username || 'Пользователь',
          callerAvatar: currentUser.avatar,
          callerAvatarColor: currentUser.avatarColor,
          chatId
        });
      } else if (isGroup) {
        sendSignalingMessage(chatId, 'incoming-call', {
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
      sendSignalingMessage(callState.chatId, 'call-accepted', { responderId: currentUser.id });
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
  }, [callState.chatId, callState.otherUserId, currentUser, chats, sendSignalingMessage]);

  const rejectCall = useCallback(() => {
    if (dataService.isLive() && callState.otherUserId) {
      sendSignalingMessage(callState.chatId, 'call-rejected', {});
    }
    endCallLocally();
  }, [callState.chatId, callState.otherUserId, endCallLocally, sendSignalingMessage]);

  const endCall = useCallback(() => {
    if (dataService.isLive()) {
      if (activeCallChannelRef.current) {
        activeCallChannelRef.current.send({
          type: 'broadcast',
          event: 'hangup',
          payload: { senderId: currentUser?.id }
        });
      } else if (callState.otherUserId) {
        sendSignalingMessage(callState.chatId, 'call-rejected', {});
      }
    }
    endCallLocally();
  }, [callState.chatId, callState.otherUserId, endCallLocally, currentUser, sendSignalingMessage]);

  /** C7: best-effort ICE restart (STUN-only; may still fail behind symmetric NAT). */
  const retryCallConnection = useCallback(async () => {
    setCallState((prev) => (
      prev.status === 'connected'
        ? { ...prev, webrtcState: 'connecting' }
        : prev
    ));

    // 1:1 Call ICE restart
    if (pcRef.current) {
      try {
        console.log(`[WebRTC Telemetry] Initiating ICE restart for 1:1 connection (state: ${pcRef.current.iceConnectionState})`);
        if (typeof pcRef.current.restartIce === 'function') {
          pcRef.current.restartIce();
        }
        const offer = await pcRef.current.createOffer({ iceRestart: true });
        await pcRef.current.setLocalDescription(offer);
        if (activeCallChannelRef.current) {
          activeCallChannelRef.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'renegotiate-offer', sdp: offer.sdp }
          });
        }
      } catch (err) {
        console.error('[WebRTC Telemetry] 1:1 ICE restart offer failed:', err);
      }
    }

    // Group mesh Call ICE restart
    const peerIds = Object.keys(pcsRef.current);
    if (peerIds.length > 0 && activeCallChannelRef.current) {
      await Promise.all(Object.keys(pcsRef.current).map(async (peerId) => {
        const pcInstance = pcsRef.current[peerId];
        if (!pcInstance) return;
        try {
          console.log(`[WebRTC Telemetry] Initiating ICE restart for group peer ${peerId} (state: ${pcInstance.iceConnectionState})`);
          if (typeof pcInstance.restartIce === 'function') {
            pcInstance.restartIce();
          }
          pcInstance.makingOffer = true;
          const offer = await pcInstance.createOffer({ iceRestart: true });
          await pcInstance.setLocalDescription(offer);
          await activeCallChannelRef.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'offer',
              sdp: offer.sdp,
              senderId: currentUserRef.current?.id,
              targetId: peerId
            }
          });
        } catch (err) {
          console.error(`[WebRTC Telemetry] Group ICE restart offer failed for peer ${peerId}:`, err);
        } finally {
          if (pcInstance) pcInstance.makingOffer = false;
        }
      }));
    }
  }, []);
  retryCallConnectionRef.current = retryCallConnection;

  const toggleCallMute = useCallback(() => {
    const nextMuted = !callState.muted;
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
        name: currentUser.name || currentUser.username || 'Пользователь',
        avatar: currentUser.avatar || '🪙',
        avatarColor: currentUser.avatarColor || currentUser.avatar_color,
        muted: nextMuted
      }).catch(error => console.error('Failed to update group call presence:', error));
    }
  }, [callState.chatId, callState.muted, chats, currentUser]);

  const toggleVoiceEnhancement = useCallback(async () => {
    if (callState.status !== 'connected' || !localStreamRef.current) return;
    try {
      if (voiceEnhancementRef.current.active) {
        await voiceEnhancementRef.current.disable(pcRef.current, pcsRef.current);
        setVoiceEnhancementEnabled(false);
      } else {
        await voiceEnhancementRef.current.enable(localStreamRef.current, pcRef.current, pcsRef.current);
        setVoiceEnhancementEnabled(true);
      }
      setMediaError(null);
    } catch (error) {
      console.error('Voice enhancement failed:', error);
      setVoiceEnhancementEnabled(false);
      setMediaError('Не удалось переключить улучшение голоса.');
    }
  }, [callState.status]);

  const {
    toggleCallVideo,
    toggleCallScreenShare
  } = useCallMedia({
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
    setMediaError
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
      toggleVoiceEnhancement
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCalls = () => useContext(CallContext);
