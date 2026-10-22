import { useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { dataService } from '../../services/dataLayer';
import { refreshIceConfiguration, createPeerConnection, resetIceConfiguration } from './iceServers';
import { secureCallChannel } from './secureCallChannel';
import { createCallPeerSession } from './callPeerSession';
import { createCallQualitySampler } from './callQuality';
import { CALL_AUDIO_CONSTRAINTS } from './voiceEnhancement';
import { startAudioAnalyzer } from './audioAnalyzer';
import { attachRemoteAudioElement } from './mediaTrackHelpers';

/** One media lifetime per account/call. Profile and crypto callback updates do
 * not close a working transport; all asynchronous work is session-scoped. */
export function useCallTransport(options) {
  const latest = useRef(options);
  latest.current = options;
  const reconcileMembershipRef = useRef(null);
  const membersKey = JSON.stringify((options.callChatRef.current?.members || []).map(member => member.id).sort());
  const { status, callId, userId, teardownMedia, endCallLocally } = options;

  useEffect(() => {
    resetIceConfiguration();
    return () => resetIceConfiguration();
  }, [userId]);

  useEffect(() => {
    if (status !== 'connected' || !userId) return undefined;
    const refs = latest.current;
    if (refs.callStateRef.current.ownerId && refs.callStateRef.current.ownerId !== userId) return undefined;
    const chat = refs.callChatRef.current;
    if (!chat) return undefined;
    const group = chat.type === 'group';
    const selfId = userId;
    const peerId = refs.callStateRef.current.otherUserId;
    let active = true;
    let subscribed = false;
    let channel = null;
    let localStream = null;
    let configuration = null;
    let qualityBusy = false;
    const timers = new Set();
    const missing = new Map();
    const sampler = createCallQualitySampler();
    const sessions = refs.peerSessionsRef.current;
    const peerStates = new Map();
    const remoteVideoResetters = new Map();
    // A group member can leave and rejoin while everybody else keeps talking.
    // Membership alone cannot authorise delayed signals from their old call.
    const peerLifetimes = new Map();
    let presentMembers = new Set();
    const validSessionId = value => {
      return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;
    };
    const sessionIdOf = payload => validSessionId(payload?.sessionId);
    const lifetimeFor = id => {
      let lifetime = peerLifetimes.get(id);
      if (!lifetime) peerLifetimes.set(id, lifetime = { id: null, ended: new Set(), closed: false, sawAbsent: false });
      return lifetime;
    };
    const retireLifetime = (lifetime, id) => {
      if (!id) return;
      lifetime.ended.add(id);
      if (lifetime.ended.size > 32) lifetime.ended.delete(lifetime.ended.values().next().value);
    };
    const live = () => active && latest.current.userId === selfId;
    const members = () => latest.current.callChatRef.current?.members || [];
    const isMember = id => id !== selfId && members().some(member => member.id === id);
    const setCall = update => { if (live()) refs.setCallState(update); };
    const participants = update => { if (live()) refs.setGroupCallParticipants(update); };
    const delay = (fn, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); if (live()) fn(); }, ms);
      timers.add(timer);
      return timer;
    };
    const stopMissing = id => {
      const timer = missing.get(id);
      if (timer) { clearTimeout(timer); timers.delete(timer); }
      missing.delete(id);
    };
    const updateState = () => {
      if (!live()) return;
      const pcs = group ? Object.values(refs.pcsRef.current) : [refs.pcRef.current].filter(Boolean);
      const connected = pcs.some(pc => pc.connectionState === 'connected')
        || (group && subscribed && localStream && pcs.length === 0);
      const failed = pcs.length > 0 && pcs.every(pc => pc.connectionState === 'failed' || pc.connectionState === 'closed'
        || peerStates.get(pc) === 'failed');
      setCall(previous => ({ ...previous, webrtcState: connected ? 'connected' : failed ? 'failed' : 'connecting' }));
    };
    const ensureParticipant = id => {
      const member = members().find(item => item.id === id);
      participants(previous => previous.some(item => item.id === id) ? previous : [...previous, {
        id, name: member?.name || 'Участник', avatar: member?.avatar || '👤',
        avatarColor: member?.avatarColor || member?.avatar_color,
        muted: false, speaking: false, videoStream: null, isReal: true
      }]);
    };
    const removePeer = id => {
      stopMissing(id);
      sessions.get(id)?.dispose();
      sessions.delete(id);
      remoteVideoResetters.delete(id);
      const pc = refs.pcsRef.current[id];
      delete refs.pcsRef.current[id];
      if (pc) { sampler.reset(pc); pc.close(); }
      peerStates.delete(pc);
      refs.audioAnalyzersRef.current[id]?.stop();
      delete refs.audioAnalyzersRef.current[id];
      // IDs here are internal app user IDs, never network addresses or SDP.
      document.querySelectorAll('.webrtc-remote-audio-feed').forEach(element => {
        if (element.dataset.callPeer === id) { element.srcObject = null; element.remove(); }
      });
      participants(previous => previous.filter(item => item.id !== id));
      updateState();
    };
    const acceptLifetime = (id, payload, source) => {
      if (!group) return true;
      const lifetime = lifetimeFor(id);
      const nextId = sessionIdOf(payload);
      if (nextId) {
        if (lifetime.ended.has(nextId)) return false;
        if (lifetime.id && lifetime.id !== nextId) {
          retireLifetime(lifetime, lifetime.id);
          removePeer(id);
        }
        lifetime.id = nextId;
        lifetime.closed = false;
        lifetime.sawAbsent = false;
        return true;
      }
      // Old clients include callId only on video-stopped, never on their SDP
      // or presence. Bind that control event without upgrading their protocol.
      const controlId = payload?.type === 'video-stopped' ? validSessionId(payload.callId) : null;
      if (controlId) return !lifetime.closed && !lifetime.ended.has(controlId)
        && (!lifetime.id || lifetime.id === controlId);
      if (lifetime.closed) {
        // Older clients have no session metadata. Only a genuine presence
        // leave/rejoin may reopen them; an old offer or join broadcast cannot.
        if (source !== 'presence' || !lifetime.sawAbsent || !presentMembers.has(id)) return false;
        lifetime.id = null;
        lifetime.closed = false;
        lifetime.sawAbsent = false;
      }
      // Profile/mute presence from an older client may omit metadata. It must
      // not downgrade an already identified peer or authorise unbound SDP.
      return !lifetime.id || source === 'presence';
    };
    const endPeerLifetime = (id, payload) => {
      const lifetime = lifetimeFor(id);
      const endedId = sessionIdOf(payload) ?? validSessionId(payload?.callId);
      retireLifetime(lifetime, endedId);
      // A delayed hangup from an earlier call must preserve the fresh peer.
      if (endedId && lifetime.id && endedId !== lifetime.id) return;
      retireLifetime(lifetime, lifetime.id);
      lifetime.closed = true;
      lifetime.sawAbsent = !presentMembers.has(id);
      removePeer(id);
    };
    const reconcileMembership = () => {
      if (!live() || !group) return;
      for (const id of sessions.keys()) if (!isMember(id)) removePeer(id);
    };
    reconcileMembershipRef.current = reconcileMembership;
    const markMissing = id => {
      if (missing.has(id)) return;
      missing.set(id, delay(() => {
        missing.delete(id);
        const pc = refs.pcsRef.current[id];
        // Presence is signaling state, not proof that a working media path left.
        if (subscribed && pc && !['connected', 'completed'].includes(pc.iceConnectionState)
          && pc.connectionState !== 'connected') removePeer(id);
        else if (pc) markMissing(id);
      }, 15_000));
    };
    const send = async payload => {
      if (!live() || !subscribed || !channel) throw new Error('Call signaling is reconnecting.');
      if (group && !isMember(payload.targetId)) return 'cancelled';
      const result = await channel.send({ type: 'broadcast', event: 'signal', payload: {
        ...payload, senderId: selfId, ...(group ? { sessionId: callId } : { callId })
      } });
      if (result !== 'ok') throw new Error('Call signal was not acknowledged.');
    };
    const addPeer = id => {
      const existing = sessions.get(id);
      if (existing) return existing;
      const pc = createPeerConnection(configuration);
      if (group) { refs.pcsRef.current[id] = pc; ensureParticipant(id); }
      else refs.pcRef.current = pc;
      const peerLive = () => live() && (!group || (isMember(id) && refs.pcsRef.current[id] === pc));
      let remoteVideo = null;
      let remoteVideoTrack = null;
      let remoteVideoKind = 'camera';
      let remoteVideoRevision = -1;
      const acceptVideoRevision = revision => {
        if (Number.isSafeInteger(revision) && revision >= 0) {
          if (revision < remoteVideoRevision) return false;
          remoteVideoRevision = revision;
        }
        return true;
      };
      const presentRemoteVideo = () => {
        if (!peerLive()) return;
        const stream = remoteVideoKind === null ? null : remoteVideo;
        const screen = Boolean(stream && remoteVideoKind === 'screen');
        if (group) participants(previous => previous.map(item => item.id === id ? {
          ...item, videoStream: stream, cameraStream: screen ? null : stream,
          screenStream: screen ? stream : null,
          isCameraActive: Boolean(stream && !screen), isScreenSharing: screen
        } : item));
        else {
          refs.setRemoteVideoStream(stream);
          setCall(previous => ({ ...previous, isRemoteScreenSharing: screen }));
        }
      };
      remoteVideoResetters.set(id, revision => {
        if (!acceptVideoRevision(revision)) return;
        remoteVideo = null;
        remoteVideoTrack = null;
        remoteVideoKind = null;
        presentRemoteVideo();
      });
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      refs.localVideoStreamRef.current?.getVideoTracks().filter(track => track.readyState === 'live')
        .forEach(track => pc.addTrack(track, refs.localVideoStreamRef.current));
      const engine = createCallPeerSession({
        pc, group, polite: String(selfId) < String(id), isCurrent: peerLive,
        getAudioTrack: () => refs.localStreamRef.current?.getAudioTracks()[0],
        getVideoRevision: () => refs.videoRevisionRef?.current,
        getVideoKind: () => {
          const video = refs.localVideoStreamRef.current;
          if (!video?.getVideoTracks().some(track => track.readyState === 'live')) return null;
          return refs.screenStreamRef.current === video ? 'screen' : 'camera';
        },
        onRemoteVideoKind: (kind, revision) => {
          if (!acceptVideoRevision(revision)) return;
          remoteVideoKind = kind;
          presentRemoteVideo();
        },
        send: payload => send({ ...payload, ...(group ? { targetId: id } : {}) }),
        prepareRestart: async () => {
          const configuration = await refreshIceConfiguration({ allowDirectConnection: true, cacheKey: selfId, forceRefresh: true });
          return live() ? configuration : null;
        },
        onState: state => { peerStates.set(pc, state); updateState(); },
        onError: () => { /* Retry/state reporting belongs to the peer controller. */ }
      });
      sessions.set(id, engine);
      pc.ontrack = event => {
        if (!peerLive()) return;
        const track = event.track;
        if (track.kind === 'audio') {
          const stream = new MediaStream([track]);
          const key = group ? id : 'remote';
          const element = attachRemoteAudioElement(`webrtc-audio-${id}-${track.id}`, stream);
          element.dataset.callPeer = id;
          refs.audioAnalyzersRef.current[key]?.stop();
          refs.audioAnalyzersRef.current[key] = startAudioAnalyzer(stream, speaking => {
            if (!peerLive()) return;
            if (group) participants(previous => previous.map(item => item.id === id ? { ...item, speaking } : item));
            else setCall(previous => previous.isRemoteSpeaking === speaking ? previous : { ...previous, isRemoteSpeaking: speaking });
          });
          track.onended = () => {
            element.srcObject = null;
            element.remove();
            if (!peerLive()) return;
            refs.audioAnalyzersRef.current[key]?.stop();
            delete refs.audioAnalyzersRef.current[key];
          };
        } else if (track.kind === 'video') {
          remoteVideo = event.streams[0] || new MediaStream([track]);
          remoteVideoTrack = track;
          presentRemoteVideo();
          track.onended = () => {
            if (!peerLive() || remoteVideoTrack !== track) return;
            remoteVideo = null;
            remoteVideoTrack = null;
            presentRemoteVideo();
          };
        }
        // ontrack announces an SDP track; it does not establish connectivity.
      };
      return engine;
    };
    const sampleQuality = async () => {
      if (!live() || qualityBusy) return;
      qualityBusy = true;
      try {
        const pcs = group ? Object.values(refs.pcsRef.current) : [refs.pcRef.current].filter(Boolean);
        const peers = await Promise.all(pcs.map(pc => sampler.sample(pc)));
        if (live()) refs.setCallQuality({ peers: peers.filter(Boolean) });
      } finally { qualityBusy = false; }
    };
    const initialize = async () => {
      let captured = null;
      // Start both preparations together, but still clean up a late microphone
      // grant if the call ends while the ICE request is in flight.
      const capture = navigator.mediaDevices.getUserMedia({ audio: CALL_AUDIO_CONSTRAINTS }).then(stream => {
        if (!live()) stream.getTracks().forEach(track => track.stop());
        else captured = stream;
        return stream;
      });
      try {
        [configuration] = await Promise.all([refreshIceConfiguration({ allowDirectConnection: true, cacheKey: selfId }), capture]);
        if (!live()) { captured?.getTracks().forEach(track => track.stop()); return; }
        localStream = captured;
        refs.localStreamRef.current = localStream;
        localStream.getAudioTracks().forEach(track => { track.enabled = !refs.callStateRef.current.muted; });
        refs.audioAnalyzersRef.current.local = startAudioAnalyzer(localStream, speaking => {
          setCall(previous => previous.isLocalSpeaking === speaking ? previous : { ...previous, isLocalSpeaking: speaking });
          participants(previous => previous.map(item => item.id === selfId ? { ...item, speaking } : item));
        });
        if (!dataService.isLive()) { setCall(previous => ({ ...previous, webrtcState: 'connected' })); return; }
        channel = secureCallChannel(supabase.channel(`call:chat:${chat.id}:media`, {
          config: { private: true, broadcast: { ack: true }, ...(group ? { presence: { key: selfId } } : {}) }
        }), {
          chatId: chat.id, cryptoVersion: chat.cryptoVersion,
          encryptEvent: (...args) => latest.current.encryptEvent(...args),
          decryptEvent: (...args) => latest.current.decryptEvent(...args),
          shouldSend: message => {
            if (live()) return !group || message.event !== 'signal' || isMember(message.payload?.targetId);
            const ending = refs.endingSignalingRef.current;
            return message.event === 'hangup' && ending?.channel === channel
              && ending.callId === callId && ending.userId === latest.current.userId
              && Date.now() < ending.expiresAt
              && !['calling', 'incoming', 'connected'].includes(refs.callStateRef.current.status);
          }
        });
        refs.activeCallChannelRef.current = channel;
        if (!group) addPeer(peerId);
        if (group) channel
          .on('presence', { event: 'sync' }, () => {
            if (!live() || !subscribed) return;
            const entries = Object.values(channel.presenceState()).flat().filter(entry => isMember(entry.id));
            presentMembers = new Set(entries.map(entry => entry.id));
            for (const [id, lifetime] of peerLifetimes) {
              if (lifetime.closed && !presentMembers.has(id)) lifetime.sawAbsent = true;
            }
            const present = new Set();
            for (const entry of entries) {
              const id = entry.id;
              if (!acceptLifetime(id, entry, 'presence')) continue;
              present.add(id); stopMissing(id); ensureParticipant(id);
              participants(previous => previous.map(item => item.id === id ? { ...item, muted: Boolean(entry.muted) } : item));
              const engine = addPeer(id);
              engine.signalReady();
              if (String(selfId) < String(id) && !refs.pcsRef.current[id]?.remoteDescription) void engine.negotiate();
            }
            for (const id of sessions.keys()) if (!present.has(id)) markMissing(id);
          })
          .on('broadcast', { event: 'join-group-call' }, ({ payload }) => {
            if (!live() || !isMember(payload?.senderId) || !acceptLifetime(payload.senderId, payload, 'join')) return;
            stopMissing(payload.senderId);
            const engine = addPeer(payload.senderId);
            engine.signalReady();
            const pc = refs.pcsRef.current[payload.senderId];
            if (pc.connectionState !== 'connected') void engine.negotiate();
          });
        channel
          .on('broadcast', { event: 'signal' }, async ({ payload }) => {
            if (!live() || !payload) return;
            const id = group ? payload.senderId : peerId;
            if (group ? payload.targetId !== selfId || !isMember(id)
              : (payload.callId && payload.callId !== callId) || (payload.senderId && payload.senderId !== peerId)) return;
            if (!acceptLifetime(id, payload, 'signal')) return;
            const engine = addPeer(id);
            if (payload.type === 'video-stopped') {
              remoteVideoResetters.get(id)?.(payload.videoRevision);
            } else if (payload.type === 'ready') {
              engine.signalReady();
              if (refs.callStateRef.current.isOutgoing && refs.pcRef.current?.connectionState !== 'connected') void engine.negotiate();
            } else await engine.receive(payload);
          })
          .on('broadcast', { event: 'hangup' }, ({ payload }) => {
            if (!live()) return;
            if (group) { if (isMember(payload?.senderId)) endPeerLifetime(payload.senderId, payload); }
            else if ((!payload?.callId || payload.callId === callId)
              && (!payload?.senderId || payload.senderId === peerId)) endCallLocally();
          })
          .subscribe(async state => {
            if (!live()) return;
            subscribed = state === 'SUBSCRIBED';
            if (!subscribed) return; // A signaling outage must preserve working media.
            try {
              if (group) {
                await channel.track({ id: selfId, sessionId: callId, name: refs.currentUserRef.current?.name || 'Вы',
                  avatar: refs.currentUserRef.current?.avatar, muted: refs.callStateRef.current.muted });
                if (!live()) return;
                await channel.send({ type: 'broadcast', event: 'join-group-call', payload: { senderId: selfId, sessionId: callId } });
              } else {
                const engine = sessions.get(peerId);
                engine.signalReady();
                if (refs.callStateRef.current.isOutgoing && refs.pcRef.current?.connectionState !== 'connected') void engine.negotiate();
                else await send({ type: 'ready' });
              }
              for (const engine of sessions.values()) engine.signalReady();
            } catch { /* The peer controller retries pending media exchanges. */ }
          });
        const interval = setInterval(() => { void sampleQuality(); }, 2_000);
        timers.add(interval);
        void sampleQuality();
      } catch {
        captured?.getTracks().forEach(track => track.stop());
        if (!live()) return;
        refs.setMediaError('Не удалось подготовить звонок. Проверьте доступ к микрофону и подключение.');
        endCallLocally();
      }
    };
    void initialize();
    const wake = () => { if (live()) for (const engine of sessions.values()) engine.signalReady(); };
    window.addEventListener('online', wake);
    return () => {
      active = false;
      if (reconcileMembershipRef.current === reconcileMembership) reconcileMembershipRef.current = null;
      window.removeEventListener('online', wake);
      for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
      for (const engine of sessions.values()) engine.dispose();
      sessions.clear();
      sampler.reset();
      refs.setCallQuality({ peers: [] });
      teardownMedia();
    };
  }, [status, callId, userId, teardownMedia, endCallLocally]);

  useEffect(() => {
    reconcileMembershipRef.current?.();
  }, [membersKey, status, callId, userId]);
}
