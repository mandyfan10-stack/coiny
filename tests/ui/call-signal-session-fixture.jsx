import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCallSignaling } from '../../src/context/calls/useCallSignaling';
import { supabase } from '../../src/supabaseClient';
import { dataService } from '../../src/services/dataLayer';

// Only the MLS boundary and network are synthetic. Both peers use the actual
// signaling hook, secure channel, invitation retries and application receipts.
const people = [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }];
const commonChat = { id: 'common-chat', cryptoVersion: 2, type: 'personal', members: people };
const control = { channels: [], sent: [] };
window.__callSignalSessionTest = control;
dataService.isLive = () => true;
supabase.channel = topic => {
  const channel = {
    topic: `realtime:${topic}`, fixtureId: control.channels.length, connected: false, listeners: [],
    on(_type, filter, callback) { this.listeners.push({ event: filter.event, callback }); return this; },
    subscribe(callback) { this.connected = true; callback('SUBSCRIBED'); return this; },
    unsubscribe() { this.connected = false; },
    async send(message) {
      const decoded = message.payload.envelope.decoded;
      control.sent.push({ ...decoded, sender: message.payload.envelope.senderDeviceId });
      if (!this.connected) return 'timed out';
      for (const peer of control.channels.filter(item => item !== this && item.connected && item.topic === this.topic)) {
        for (const listener of peer.listeners.filter(item => item.event === message.event)) {
          queueMicrotask(() => { void listener.callback({ payload: message.payload }); });
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
  const [chats, setChats] = useState([commonChat]);
  const signalingChannelKey = chats.map(chat => `${chat.id}:${chat.cryptoVersion ?? 1}`).sort().join(',');
  const { sendSignalingMessage, globalSignalingChannelRef } = useCallSignaling({
    currentUser: { id }, chats, signalingChannelKey, callState: state, setCallState: setState,
    onRemoteEnd: () => setState(previous => ({ ...previous, status: 'ended' })),
    encryptEvent: async (chatId, eventType, decoded) => ({ chatId, eventType, senderDeviceId: `device-${id}`, decoded }),
    decryptEvent: async envelope => envelope.decoded
  });
  control[id] = { state, setState, setChats, send: sendSignalingMessage, channels: globalSignalingChannelRef };
  return <output data-testid={id}>{state.status}</output>;
}

control.start = callId => {
  control.A.setState({ status: 'calling', chatId: commonChat.id, callId, otherUserId: 'B', isOutgoing: true });
  control.A.send(commonChat.id, 'incoming-call', {
    callerId: 'A', chatId: commonChat.id, callId, expiresAt: Date.now() + 60_000
  });
};
control.accept = () => {
  control.B.send(commonChat.id, 'call-accepted', { responderId: 'B', callId: control.B.state.callId });
  control.B.setState(previous => ({ ...previous, status: 'connected' }));
};
control.end = () => {
  control.A.send(commonChat.id, 'call-rejected', { senderId: 'A', callerId: 'A', callId: control.A.state.callId });
  control.A.setState(previous => ({ ...previous, status: 'ended' }));
};
control.reset = () => {
  control.A.setState({ status: 'idle' });
  control.B.setState({ status: 'idle' });
};
control.addUnrelatedChat = () => control.A.setChats(previous => [...previous, {
  id: 'unrelated-new-chat', cryptoVersion: 2, type: 'personal', members: [people[0]]
}]);

function Harness() {
  const [senderInstance, setSenderInstance] = useState(0);
  control.reloadSender = () => setSenderInstance(previous => previous + 1);
  return <><Peer key={`A-${senderInstance}`} id="A"/><Peer key="B" id="B"/></>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
