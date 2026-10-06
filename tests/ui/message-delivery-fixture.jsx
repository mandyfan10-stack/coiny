import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useOfflineSync } from '../../src/context/chat/useOfflineSync';
import { useChatActions } from '../../src/context/chat/useChatActions';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';

const self = { id: 'delivery-self', name: 'Вы' };
const group = { id: 'group', type: 'group', name: 'Группа', members: [self], messages: [] };
const controller = { attempts: [], sent: [], alerts: [], modes: {} };
window.__deliveryTest = controller;
window.alert = message => controller.alerts.push(message);
dataService.isLive = () => true;
dataService.sendMessage = async (...args) => {
  controller.attempts.push(args);
  const mode = controller.modes[args[0]];
  if (mode === 'empty') return null;
  if (mode === 'network') throw new Error('failed to fetch');
  if (mode === 'permission') throw new Error('permission denied');
  controller.sent.push(args);
  return { id: args[5], created_at: new Date().toISOString() };
};

// Exercise the real chat formatter with synthetic server rows and a trusted RPC ID.
controller.fetchChats = async ({ savedId = 'saved', peerName = 'Избранное', rpcFails = false, omitPeer = false, countFails = false } = {}) => {
  const rawChats = [
    { id: 'saved', type: 'personal', name: 'Избранное', created_by: self.id },
    { id: 'personal', type: 'personal', name: peerName, created_by: self.id }
  ];
  supabase.rpc = async name => {
    if (name === 'ensure_saved_messages_chat') return rpcFails
      ? { data: null, error: new Error('RPC unavailable') }
      : { data: savedId, error: null };
    return { data: [], error: null };
  };
  supabase.from = table => {
    const steps = [];
    const query = {};
    for (const method of ['select', 'eq', 'in', 'single']) {
      query[method] = (...args) => { steps.push({ method, args }); return query; };
    }
    query.then = (resolve, reject) => {
      if (steps.some(step => step.method === 'select' && step.args[1]?.head)) {
        const id = steps.find(step => step.method === 'eq' && step.args[0] === 'chat_id').args[1];
        return Promise.resolve({
          data: null, count: countFails ? null : id === 'saved' ? 1 : 2,
          error: countFails ? new Error('Count unavailable') : null
        }).then(resolve, reject);
      }
      let data = [];
      if (table === 'chats') data = rawChats;
      if (table === 'chat_members') data = steps.some(step => step.method === 'select' && step.args[0].includes('profiles('))
        ? [
            { chat_id: 'saved', profile_id: self.id, profiles: { display_name: self.name } },
            { chat_id: 'personal', profile_id: self.id, profiles: { display_name: self.name } },
            { chat_id: 'personal', profile_id: 'peer', profiles: { display_name: peerName, username: 'saved_messages' } }
          ]
        : [{ chat_id: 'saved' }, { chat_id: 'personal' }];
      if (omitPeer && table === 'chat_members') data = data.filter(member => member.profile_id !== 'peer');
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return query;
  };
  return dataService.fetchChats(self.id);
};

function Harness() {
  const [chats, setChats] = useState([group]);
  const [activeChatId, setActiveChatId] = useState('group');
  const [sharedKeys, setSharedKeysCache] = useState({});
  const e2eePrivateKeyRef = useRef(null);
  const sharedKeysCacheRef = useRef(sharedKeys); sharedKeysCacheRef.current = sharedKeys;
  const sync = useOfflineSync({
    currentUser: self, chats, setChats, e2eePrivateKeyRef, sharedKeysCacheRef, setSharedKeysCache
  });
  const actions = useChatActions({
    currentUser: self, chats, setChats, activeChatId, setActiveChatId,
    activeChat: chats.find(chat => chat.id === activeChatId),
    setOfflineQueue: sync.setOfflineQueue, e2eePrivateKeyRef, sharedKeysCacheRef, setSharedKeysCache
  });
  Object.assign(controller, {
    state: { chats, queue: sync.offlineQueue, online: sync.isOnline },
    queue: sync.setOfflineQueue, sync: sync.syncOfflineMessages,
    addChat: chat => setChats(previous => [...previous.filter(item => item.id !== chat.id), chat]),
    select: setActiveChatId, send: actions.sendMessage,
    retry: sync.retrySendMessage
  });
  return <p>Проверка доставки сообщений</p>;
}
createRoot(document.getElementById('root')).render(<Harness />);
