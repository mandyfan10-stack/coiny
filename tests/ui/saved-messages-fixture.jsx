import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatProvider, useChat } from '../../src/context/chat/ChatProvider';
import MainMenuDrawer from '../../src/components/MainMenuDrawer';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';
import '../../src/index.css';

const noop = () => {};
const control = { rpcCalls: 0, fetchCalls: 0, available: new URLSearchParams(location.search).has('existing') };
window.__saved = control;
const notes = owner => ({ id: `saved-${owner}`, name: 'Избранное', type: 'personal', createdBy: owner,
  savedMessagesOwnerId: owner, members: [{ id: owner, name: owner }], messages: [] });
const source = { id: 'source', name: 'Разговор', type: 'group', members: [], messages: [] };
// Only network boundaries are replaced; navigation, loading, actions and drawer
// all use the production provider. No real account is accessed.
dataService.isLive = () => true;
dataService.fetchChats = async owner => {
  control.fetchCalls++;
  if (control.holdFetch) await new Promise(resolve => { control.releaseFetch = resolve; });
  if (control.failFetch) throw new Error('Test list failure');
  return [source, ...(control.available ? [{ ...notes(owner), ...(control.untrusted ? { members: [{ id: owner }, { id: 'peer' }] } : {}) }] : [])];
};
dataService.loadChatMessages = async () => [];
dataService.fetchStickers = async () => [];
dataService.fetchStories = async () => [];
dataService.markMessagesAsRead = async () => 0;
supabase.rpc = async name => {
  if (name !== 'ensure_saved_messages_chat') throw new Error(`Unexpected RPC: ${name}`);
  control.rpcCalls++;
  const owner = control.owner;
  if (control.holdRpc) await new Promise(resolve => { control.releaseRpc = resolve; });
  if (control.failRpc) return { data: null, error: { code: '42501', message: 'Test membership denial' } };
  control.available = true;
  return { data: control.noId ? null : `saved-${owner}`, error: null };
};
supabase.from = () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) });
supabase.channel = () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => {},
    send: async () => {}, presenceState: () => ({}), track: async () => {} };
  return channel;
};
supabase.removeChannel = async () => {};
function Observe() {
  const chat = useChat();
  control.chat = chat;
  return <><button onClick={() => chat.setIsDrawerOpen(true)}>Меню</button>
    <p data-testid="active-chat">{chat.activeChat?.id || 'none'}</p>
    <p data-testid="loaded">{chat.chats.length}</p><MainMenuDrawer/></>;
}
function Harness() {
  const [user, setUser] = useState({ id: 'self', name: 'Алексей' });
  control.owner = user?.id;
  control.setUser = setUser;
  return <AuthContext.Provider value={{ currentUser: user, updateProfile: noop }}>
    <E2EEContext.Provider value={{ e2eePrivateKey: null, sharedKeysCache: {}, setSharedKeysCache: noop }}>
      <ChatProvider><Observe/></ChatProvider>
    </E2EEContext.Provider>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
