import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatProvider, useChat } from '../../src/context/chat/ChatProvider';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';

const noop = () => {};
const controller = { requests: [] };
window.__accountIsolation = controller;
const request = (kind, owner, chatId, limit) => new Promise((resolve) => {
  controller.requests.push({ kind, owner, chatId, limit, resolve, done: false });
});
controller.complete = (index, data) => {
  const pending = controller.requests[index];
  if (!pending || pending.done) throw new Error('Request is unavailable');
  pending.done = true;
  pending.resolve(data);
};

// Keep the real auth and chat providers. Only the external boundaries are fake;
// no fixture request can read or write a real account.
dataService.isLive = () => true;
dataService.fetchProfile = async (id) => ({ id, display_name: id, username: id });
dataService.fetchChats = (owner) => request('chats', owner);
dataService.loadChatMessages = (chatId, limit) => request('messages', controller.auth.currentUser?.id, chatId, limit);
dataService.fetchStickers = async () => [];
dataService.fetchStories = async () => [];
dataService.markMessagesAsRead = async () => 0;
dataService.signIn = async (id) => {
  controller.authEvent('SIGNED_IN', { user: { id } });
  return { data: { user: { id } } };
};
dataService.signOut = async () => controller.authEvent('SIGNED_OUT', null);
supabase.auth.getSession = async () => ({ data: { session: null } });
supabase.auth.onAuthStateChange = (callback) => {
  controller.authEvent = callback;
  return { data: { subscription: { unsubscribe: noop } } };
};
supabase.from = () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) });
supabase.channel = () => {
  const channel = {
    on: () => channel, subscribe: () => channel, unsubscribe: async () => {},
    send: async () => {}, presenceState: () => ({}), track: async () => {}
  };
  return channel;
};
supabase.removeChannel = async () => {};

function Observe() {
  const auth = useAuth();
  const chat = useChat();
  Object.assign(controller, { auth, chat, login: auth.signInWithIdentifier, logout: auth.logOut });
  return <p data-testid="owner">{auth.currentUser?.id || 'signed-out'}</p>;
}

createRoot(document.getElementById('root')).render(
  <AuthProvider><E2EEContext.Provider value={{ e2eePrivateKey: null, sharedKeysCache: {}, setSharedKeysCache: noop }}>
    <ChatProvider><Observe /></ChatProvider>
  </E2EEContext.Provider></AuthProvider>
);
