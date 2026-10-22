import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatProvider, useChat } from '../../src/context/chat/ChatProvider';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';
import StoryViewer from '../../src/components/StoryViewer';
import { generateE2EEKeyPair as generateKeyPair, exportPublicKey } from '../../src/utils/e2eeHelper';
import '../../src/index.css';

const noop = () => {};
const controller = { requests: [] };
const storyMode = new URLSearchParams(location.search).has('story');
const storyKeys = storyMode ? Promise.all([generateKeyPair(), generateKeyPair()]).then(async ([owner, peer]) => {
  const keys = { owner, peer, ownerPublic: await exportPublicKey(owner.publicKey), peerPublic: await exportPublicKey(peer.publicKey) };
  controller.storyKeys = keys;
  return keys;
}) : Promise.resolve(null);
controller.sent = [];
controller.created = [];
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
dataService.fetchProfile = async (id) => {
  const keys = await storyKeys;
  return { id, display_name: id, username: id, ...(keys ? { has_e2ee: true, public_key: id === 'story-peer' ? keys.peerPublic : keys.ownerPublic } : {}) };
};
dataService.fetchChats = (owner) => request('chats', owner);
dataService.loadChatMessages = (chatId, limit) => request('messages', controller.auth.currentUser?.id, chatId, limit);
dataService.fetchStickers = async () => [];
dataService.fetchStories = async () => storyMode ? [{ id: 'peer-story', user_id: 'story-peer', profiles: { display_name: 'Автор истории' }, media: '/code_story.png', created_at: new Date().toISOString() }] : [];
dataService.createChat = async (_owner, target) => {
  controller.created.push(target.id);
  return { id: 'story-private', type: 'personal', name: target.display_name };
};
dataService.sendMessage = async (chatId, senderId, text, replyTo, media, id) => {
  controller.sent.push({ chatId, senderId, text, replyTo, media, id });
  if (controller.holdSend) await new Promise(resolve => { controller.confirmSend = resolve; });
  return { id };
};
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
  return <><p data-testid="owner">{auth.currentUser?.id || 'signed-out'}</p>{storyMode && <>
    <button onClick={() => chat.viewStory('peer-story')}>Открыть историю</button><StoryViewer/>
  </>}</>;
}

function ChatHarness() {
  const [keys, setKeys] = React.useState(null);
  const [sharedKeysCache, setSharedKeysCache] = React.useState({});
  React.useEffect(() => { void storyKeys.then(setKeys); }, []);
  return <E2EEContext.Provider value={{ e2eePrivateKey: keys?.owner.privateKey || null, sharedKeysCache, setSharedKeysCache }}>
    <ChatProvider><Observe /></ChatProvider>
  </E2EEContext.Provider>;
}

createRoot(document.getElementById('root')).render(
  <AuthProvider><ChatHarness/></AuthProvider>
);
