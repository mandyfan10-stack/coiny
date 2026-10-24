import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatProvider, useChat } from '../../src/context/chat/ChatProvider';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';
import { useInviteHandler } from '../../src/hooks/useInviteHandler';
import InviteLinkStatus from '../../src/components/InviteLinkStatus';
import { parseInviteParam, savePendingInvite, clearInviteParamFromUrl, getPendingInvite } from '../../src/utils/inviteLink';
import '../../src/index.css';

const noop = () => {};
const options = new URLSearchParams(location.search);
const control = { requests: [], chats: new Map(), history: [] };
window.__invite = control;
function list(owner) {
  if (!control.chats.has(owner)) control.chats.set(owner, [{ id: 'shared-group', type: 'group', name: 'Общая группа',
    members: [{ id: owner, username: owner }, { id: 'peer', username: 'pasha_gug' }], messages: [] }]);
  return control.chats.get(owner);
}
const privateChat = (owner, target) => ({ id: `chat-${owner}-${target}`, type: 'personal', username: target,
  name: target, createdBy: owner, members: [{ id: owner, username: owner }, { id: `peer-${target}`, username: target }], messages: [] });
dataService.isLive = () => true;
dataService.fetchProfile = async id => ({ id, username: id, display_name: id });
dataService.fetchChats = async owner => {
  if (control.failRefresh) throw new Error('Test refresh failure');
  return list(owner).slice();
};
dataService.fetchStickers = async () => [];
dataService.fetchStories = async () => [];
dataService.loadChatMessages = async () => [];
dataService.markMessagesAsRead = async () => 0;
dataService.signIn = async id => {
  control.authEvent('SIGNED_IN', { user: { id } });
  return { data: { user: { id } } };
};
dataService.signOut = async () => control.authEvent('SIGNED_OUT', null);
supabase.auth.getSession = async () => ({ data: { session: options.has('signedOut') ? null : { user: { id: 'viewer' } } } });
supabase.auth.onAuthStateChange = callback => {
  control.authEvent = callback;
  return { data: { subscription: { unsubscribe: noop } } };
};
supabase.rpc = async (name, args) => {
  const owner = control.auth.currentUser?.id;
  const target = name === 'ensure_saved_messages_chat' ? owner : args.p_invite;
  const request = { owner, target, name };
  control.requests.push(request);
  if (control.holdRpc) await new Promise(resolve => { request.resolve = resolve; });
  if (control.rpcError) return { data: null, error: { code: control.rpcError, message: 'Test invite failure' } };
  const saved = name === 'ensure_saved_messages_chat';
  const chat = saved ? { ...privateChat(owner, owner), id: `saved-${owner}`, savedMessagesOwnerId: owner,
    members: [{ id: owner, username: owner }] } : privateChat(owner, target);
  if (!list(owner).some(item => item.id === chat.id)) list(owner).push(chat);
  return { data: saved ? chat.id : { chat_id: chat.id, type: chat.type, name: chat.name, username: target, status: 'personal_created' }, error: null };
};
supabase.from = () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) });
supabase.channel = () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => {},
    send: async () => {}, presenceState: () => ({}), track: async () => {} };
  return channel;
};
supabase.removeChannel = async () => {};
control.open = target => window.dispatchEvent(new CustomEvent('coiny:open-invite', { detail: { invite: target } }));
function Observe() {
  const auth = useAuth();
  const chat = useChat();
  control.auth = auth; control.chat = chat; control.pending = getPendingInvite;
  const state = useInviteHandler({ currentUser: auth.currentUser, ...chat });
  useEffect(() => { control.history.push(chat.activeChatId); }, [chat.activeChatId]);
  return <><InviteLinkStatus {...state}/><p data-testid="owner">{auth.currentUser?.id || 'signed-out'}</p>
    <p data-testid="active-chat">{chat.activeChat?.id || 'none'}</p>
    <p data-testid="loaded">{chat.chats.length}</p>
    <button onClick={() => void auth.signInWithIdentifier('viewer', 'test-password')}>Войти</button></>;
}
function Root() {
  useEffect(() => {
    const invite = parseInviteParam();
    if (invite) { savePendingInvite(invite); clearInviteParamFromUrl(); }
  }, []);
  return <AuthProvider><E2EEContext.Provider value={{ e2eePrivateKey: null, sharedKeysCache: {}, setSharedKeysCache: noop }}>
    <ChatProvider><Observe/></ChatProvider>
  </E2EEContext.Provider></AuthProvider>;
}
createRoot(document.getElementById('root')).render(<Root/>);
