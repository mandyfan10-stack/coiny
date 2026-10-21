import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../../src/context/AuthContext';
import { ChatContext } from '../../src/context/ChatContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { CallProvider, useCalls } from '../../src/context/calls/CallProvider';
import { supabase } from '../../src/supabaseClient';
import { dataService } from '../../src/services/dataLayer';
import CallQuality from '../../src/components/call/CallQuality';
import '../../src/components/call/CallOverlay.css';

// Only signaling delivery and capture sources are synthetic. The provider,
// negotiation controller, RTCPeerConnection, ICE and bidirectional RTP are real.
const control = { pcs: [], channels: [], events: [], captures: [], apis: {}, updates: {}, chatUpdates: {}, drops: {}, delays: {}, captureAttempts: [] };
window.__callTransportTest = control;
const nativeMediaDevices = navigator.mediaDevices;
// Playwright WebKit supplies mock devices. Capturing one is also required by
// WebKit's host-candidate privacy policy; permission alone does not unblock ICE.
const nativeMockCapture = window.__callTransportNativeMockCapture === true;
control.capabilities = {
  canvasCapture: typeof HTMLCanvasElement.prototype.captureStream,
  audioContext: typeof window.AudioContext,
  peerConnection: typeof window.RTCPeerConnection
};
const realReplaceTrack = RTCRtpSender.prototype.replaceTrack;
RTCRtpSender.prototype.replaceTrack = async function(track) {
  const previousTrack = this.track;
  const owner = control.pcs.find(pc => pc.getSenders().includes(this))?.fixtureOwner;
  if (control.holdDisplayReplace && !control.releaseDisplayReplace && owner === 'A'
    && control.captures.some(capture => capture.kind === 'display' && capture.stream.getVideoTracks().includes(track))) {
    await realReplaceTrack.call(this, track);
    await new Promise(resolve => { control.releaseDisplayReplace = resolve; });
    return;
  }
  if (control.holdAudioRepair && !control.heldRepair && track === null && previousTrack?.kind === 'audio' && owner === 'A') {
    // The native detachment really happens; only its promise completion is held.
    // This exposes the same null sender seen during an in-flight browser repair.
    await realReplaceTrack.call(this, track);
    await new Promise(resolve => { control.heldRepair = { sender: this, previousTrack, release: resolve }; });
    return;
  }
  return realReplaceTrack.call(this, track);
};
const RealPC = window.RTCPeerConnection;
window.RTCPeerConnection = class extends RealPC {
  constructor(configuration) {
    super({ ...configuration, iceServers: [] }); // Local host-only test, no external STUN/TURN traffic.
    this.offers = 0;
    this.restarts = 0;
    this.fixtureErrors = [];
    this.fixtureCandidates = 0;
    control.pcs.push(this);
  }
  setConfiguration(configuration) { return super.setConfiguration({ ...configuration, iceServers: [] }); }
  async createOffer(options) {
    this.offers++;
    if (options?.iceRestart) { this.restarts++; this.fixtureFailure = false; }
    return super.createOffer(options);
  }
  async setRemoteDescription(description) {
    try { await super.setRemoteDescription(description); }
    catch (error) {
      this.fixtureErrors.push({ method: 'setRemoteDescription', type: description.type, name: error.name, signaling: this.signalingState });
      throw error;
    }
    if (description.type === 'offer') this.fixtureFailure = false;
  }
  async setLocalDescription(description) {
    try { await super.setLocalDescription(description); }
    catch (error) {
      this.fixtureErrors.push({ method: 'setLocalDescription', type: description?.type, name: error.name, signaling: this.signalingState });
      throw error;
    }
  }
  async addIceCandidate(candidate) {
    this.fixtureCandidates++;
    try { return await super.addIceCandidate(candidate); }
    catch (error) {
      this.fixtureErrors.push({ method: 'addIceCandidate', name: error.name, signaling: this.signalingState });
      throw error;
    }
  }
  get connectionState() { return this.fixtureFailure ? 'failed' : super.connectionState; }
  get iceConnectionState() { return this.fixtureFailure ? 'failed' : super.iceConnectionState; }
};

async function captureVideo(kind) {
  const attempt = { kind, stage: 'requested' };
  control.captureAttempts.push(attempt);
  if (kind === 'camera' && control.rejectNextCamera) {
    control.rejectNextCamera = false;
    attempt.stage = 'failed';
    throw new DOMException('Fixture camera permission denied', 'NotAllowedError');
  }
  let stream;
  try {
    if (nativeMockCapture) stream = await nativeMediaDevices.getUserMedia({ video: true });
    else {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      canvas.getContext('2d').fillRect(0, 0, 32, 32);
      stream = canvas.captureStream(5);
    }
  }
  catch (error) { attempt.stage = 'failed'; attempt.error = error.name; throw error; }
  attempt.stage = 'created';
  attempt.trackCount = stream.getVideoTracks().length;
  const capture = { kind, stream };
  control.captures.push(capture);
  if (control.holdVideo) {
    attempt.stage = 'held';
    await new Promise(resolve => { capture.release = resolve; });
  }
  attempt.stage = 'returned';
  return stream;
}
async function captureUserMedia(constraints) {
  if (constraints?.video) return captureVideo('camera');
  const attempt = { kind: 'audio', stage: 'requested' };
  control.captureAttempts.push(attempt);
  let context;
  let stream;
  if (nativeMockCapture) stream = await nativeMediaDevices.getUserMedia(constraints);
  else {
    context = new AudioContext();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    stream = destination.stream;
    attempt.stage = 'resuming';
    await context.resume();
  }
  const capture = { context, stream };
  control.captures.push(capture);
  attempt.stage = 'resumed';
  if (control.holdCapture) await new Promise(resolve => { capture.release = resolve; });
  attempt.stage = 'returned';
  return capture.stream;
}
// A stable own property also keeps WebKit from discarding method overrides
// when it recreates the otherwise unretained native MediaDevices wrapper.
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: captureUserMedia,
  getDisplayMedia: () => captureVideo('display')
} });
dataService.isLive = () => true;
supabase.functions.invoke = async () => ({ data: { available: false }, error: null });
supabase.channel = (topic, options = {}) => {
  const channel = {
    topic: `realtime:${topic}`, listeners: [], connected: false,
    on(type, filter, callback) { this.listeners.push({ type, event: filter.event, callback }); return this; },
    subscribe(callback) { this.subscription = callback; setTimeout(() => this.connect(true), 0); return this; },
    connect(connected) {
      this.connected = connected;
      this.subscription(connected ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
      syncPresence();
    },
    unsubscribe() { this.connected = false; this.presence = null; syncPresence(); return Promise.resolve('ok'); },
    async track(presence) { this.presence = presence; syncPresence(); return 'ok'; },
    presenceState() {
      return Object.fromEntries(control.channels.filter(peer => peer.topic === this.topic && peer.connected && peer.presence)
        .map(peer => [peer.presence.id, [peer.presence]]));
    },
    async send(message) {
      const plain = message.payload?.envelope?.decoded?.payload || message.payload;
      if (control.stripVideoKinds && plain?.sdp) delete plain.videoKind;
      const type = plain?.type || message.event;
      if (plain?.sdp && plain.senderId) {
        const fragment = plain.sdp.match(/^a=ice-ufrag:([^\r\n]+)/m)?.[1];
        const pc = control.pcs.find(candidate => candidate.localDescription?.sdp.includes(`a=ice-ufrag:${fragment}`));
        if (pc) pc.fixtureOwner = plain.senderId;
      }
      control.events.push({ type, sender: plain?.senderId || plain?.callerId || null, ...(type === 'candidate' ? {
        empty: !plain.candidate?.candidate,
        fragmentMatches: !plain.candidate?.usernameFragment || control.pcs.some(pc => pc.localDescription?.sdp.includes(`a=ice-ufrag:${plain.candidate.usernameFragment}`))
      } : {}) });
      if (!this.connected) return 'timed out';
      if (control.drops[type] > 0) { control.drops[type]--; return 'ok'; }
      setTimeout(() => {
        for (const peer of control.channels) {
          if (peer === this || !peer.connected || peer.topic !== this.topic) continue;
          for (const listener of peer.listeners) {
            if (listener.type === 'broadcast' && listener.event === message.event) listener.callback({ payload: message.payload });
          }
        }
      }, control.delays[type] || 0);
      return 'ok';
    },
    options
  };
  function syncPresence() {
    queueMicrotask(() => {
      for (const peer of control.channels.filter(item => item.topic === channel.topic && item.connected)) {
        for (const listener of peer.listeners.filter(item => item.type === 'presence' && item.event === 'sync')) listener.callback();
      }
    });
  }
  control.channels.push(channel);
  return channel;
};
const group = new URLSearchParams(location.search).has('group');
const users = [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }, ...(group ? [{ id: 'C', name: 'Carol' }] : [])];
const chats = [{ id: 'fixture-chat', type: group ? 'group' : 'personal', name: 'Test call', cryptoVersion: new URLSearchParams(location.search).has('encrypted') ? 2 : 1, members: users }];
function Probe({ id }) {
  const api = useCalls();
  control.apis[id] = api;
  return <section>
    <output data-testid={`status-${id}`}>{api.callState.status}</output>{' '}
    <output data-testid={`transport-${id}`}>{api.callState.webrtcState}</output>
    <button onClick={() => api.startCall('fixture-chat')}>Start {id}</button>
    <button onClick={api.acceptCall}>Accept {id}</button>
    <button onClick={api.rejectCall}>Reject {id}</button>
    <button onClick={api.endCall}>End {id}</button>
    <button onClick={api.toggleCallMute}>Mute {id}</button>
    <button onClick={api.toggleVoiceEnhancement}>Voice {id}</button>
    <button onClick={api.toggleCallVideo}>Camera {id}</button>
    <button onClick={api.toggleCallScreenShare}>Screen {id}</button>
    <div data-testid={`quality-${id}`}><CallQuality peers={api.callQuality.peers}/></div>
    <button onClick={() => control.updates[id]()}>Profile {id}</button>
  </section>;
}
function Side({ initialUser }) {
  const [user, setUser] = React.useState(initialUser);
  control.updates[user.id] = () => setUser(previous => ({ ...previous, theme: `theme-${Date.now()}` }));
  const [visibleChats, setChats] = React.useState(chats);
  control.chatUpdates[user.id] = change => setChats(previous => change === 'remove' ? [] : previous.map(chat => ({
    ...chat, members: chat.members.filter(member => member.id !== (typeof change === 'object' ? change.removeMember : user.id))
  })));
  // Keep the actual v2 channel wrapper and its binding/replay validation. Only
  // the MLS worker result is synthetic, with the same required envelope shape.
  const encryptEvent = React.useCallback(async (chatId, eventType, decoded) => {
    if (control.holdHangup && decoded.event === 'hangup') {
      await new Promise(resolve => { control.releaseEncryption = resolve; });
    }
    return { chatId, eventType, senderDeviceId: `device-${user.id}`, decoded };
  }, [user]);
  const decryptEvent = React.useCallback(async envelope => {
    if (!user.id) throw new Error('No fixture account');
    return envelope.decoded;
  }, [user]);
  return <AuthContext.Provider value={{ currentUser: user }}><ChatContext.Provider value={{ chats: visibleChats }}>
    <E2EEContext.Provider value={{ encryptEvent, decryptEvent }}><CallProvider><Probe id={user.id}/></CallProvider></E2EEContext.Provider>
  </ChatContext.Provider></AuthContext.Provider>;
}
control.rejoin = () => {
  for (const channel of control.channels.filter(item => item.connected && item.topic.endsWith(':media'))) {
    channel.connect(false);
    channel.connect(true);
  }
};
control.counterpart = index => {
  const fragment = control.pcs[index].localDescription?.sdp.match(/^a=ice-ufrag:([^\r\n]+)/m)?.[1];
  return control.pcs.findIndex((pc, other) => other !== index && pc.remoteDescription?.sdp.includes(`a=ice-ufrag:${fragment}`));
};
control.fail = index => {
  const pc = control.pcs[index];
  pc.fixtureFailure = true;
  pc.dispatchEvent(new Event('connectionstatechange'));
  pc.dispatchEvent(new Event('iceconnectionstatechange'));
};
control.snapshot = async () => ({
  peers: await Promise.all(control.pcs.map(async pc => {
    let incoming = 0;
    let outgoing = 0;
    let incomingEnergy = null;
    if (pc.connectionState !== 'closed') {
      const stats = await pc.getStats().catch(() => null);
      stats?.forEach(stat => {
        if ((stat.kind ?? stat.mediaType) !== 'audio') return;
        if (stat.type === 'inbound-rtp') {
          incoming += stat.packetsReceived || 0;
          if (typeof stat.totalAudioEnergy === 'number') incomingEnergy = (incomingEnergy || 0) + stat.totalAudioEnergy;
        }
        if (stat.type === 'outbound-rtp') outgoing += stat.packetsSent || 0;
      });
    }
    return { connection: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState, incoming, outgoing, incomingEnergy, offers: pc.offers, restarts: pc.restarts, appliedCandidates: pc.fixtureCandidates, errors: pc.fixtureErrors };
  })),
  captures: control.captures.map(capture => capture.stream.getTracks().map(track => track.readyState)),
  audioContexts: control.captures.filter(capture => capture.context).map(capture => capture.context.state),
  captureAttempts: control.captureAttempts,
  capabilities: control.capabilities,
  ui: Object.fromEntries(Object.entries(control.apis).map(([id, api]) => [id, { status: api.callState.status, transport: api.callState.webrtcState, mediaError: api.mediaError, voiceEnabled: api.voiceEnhancementEnabled, participants: api.groupCallParticipants.map(member => ({ id: member.id, camera: Boolean(member.cameraStream), video: Boolean(member.videoStream) })) }]))
});
createRoot(document.getElementById('root')).render(<>{users.map(user => <Side key={user.id} initialUser={user}/>)}</>);
