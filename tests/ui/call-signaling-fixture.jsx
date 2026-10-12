import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCallSignaling } from '../../src/context/calls/useCallSignaling';
import { supabase } from '../../src/supabaseClient';
import { dataService } from '../../src/services/dataLayer';

const control = { channels: [], sent: [], drop: 0, failEncryption: 0, encryptionWait: null };
window.__callSignalingTest = control;
const chats = [{ id: 'chat', cryptoVersion: 2, type: 'personal', members: [
  { id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }
] }];
dataService.isLive = () => true;
supabase.channel = (topic, options) => {
  const owner = control.channels.length === 0 ? 'A' : 'B';
  const channel = {
    topic: `realtime:${topic}`, owner, options, listeners: [], connected: false,
    on(_type, filter, callback) { this.listeners.push({ event: filter.event, callback }); return this; },
    subscribe(callback) {
      this.subscription = callback;
      if (!(owner === 'B' && location.search.includes('hold=B'))) this.connect(true);
      return this;
    },
    connect(connected) {
      this.connected = connected;
      this.subscription(connected ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
    },
    unsubscribe() { this.connected = false; },
    async send(message) {
      control.sent.push({ owner, event: message.event, counter: message.payload.envelope?.decoded.counter });
      if (control.drop > 0 && message.event === 'incoming-call') { control.drop--; return 'ok'; }
      if (!this.connected) return 'timed out';
      for (const peer of control.channels.filter((item) => item !== this && item.connected)) {
        for (const listener of peer.listeners.filter((item) => item.event === message.event)) {
          await listener.callback({ payload: message.payload });
        }
      }
      return 'ok';
    }
  };
  control.channels.push(channel);
  return channel;
};

function Peer({ id }) {
  const [state, setState] = useState({ status: 'idle' });
  const [user, setUser] = useState({ id });
  const { sendSignalingMessage } = useCallSignaling({
    currentUser: user, chats, signalingChannelKey: 'chat:2', callState: state, setCallState: setState,
    onRemoteEnd: () => setState((previous) => ({ ...previous, status: 'ended' })),
    encryptEvent: async (chatId, eventType, decoded) => {
      if (control.failEncryption > 0) { control.failEncryption--; throw new Error('MLS conversation state is unavailable.'); }
      if (control.encryptionWait && decoded.event === 'incoming-call') await control.encryptionWait;
      return { chatId, eventType, senderDeviceId: `device-${id}`, decoded };
    },
    decryptEvent: async (envelope) => {
      if (control.decryptionWait) await control.decryptionWait;
      return envelope.decoded;
    }
  });
  control[id] = { state, setState, setUser, send: sendSignalingMessage };
  return <output data-testid={id}>{state.status}</output>;
}

control.start = (callId = 'call-1') => {
  const payload = { callerId: 'A', chatId: 'chat', callId, expiresAt: Date.now() + 60_000 };
  control.A.setState({ status: 'calling', chatId: 'chat', callId, otherUserId: 'B', isOutgoing: true });
  control.A.send('chat', 'incoming-call', payload);
};
control.end = () => {
  const callId = control.A.state.callId;
  control.A.send('chat', 'call-rejected', { senderId: 'A', callId });
  control.A.setState((previous) => ({ ...previous, status: 'ended' }));
};
control.accept = () => {
  control.B.send('chat', 'call-accepted', { responderId: 'B', callId: control.B.state.callId });
  control.B.setState((previous) => ({ ...previous, status: 'connected' }));
};
control.inject = async (event, payload) => {
  const peer = control.channels.find((item) => item.owner === 'B');
  const counter = (control.injectionCounter = (control.injectionCounter || 1000) + 1);
  for (const listener of peer.listeners.filter((item) => item.event === event)) {
    await listener.callback({ payload: { e2ee: 2, envelope: {
      chatId: 'chat', eventType: 'call-signal', senderDeviceId: 'device-A',
      decoded: { event, payload, counter, dtlsFingerprint: null }
    } } });
  }
};
createRoot(document.getElementById('root')).render(<><Peer id="A"/><Peer id="B"/></>);
