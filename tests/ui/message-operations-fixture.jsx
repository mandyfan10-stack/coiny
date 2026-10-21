import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import Sidebar from '../../src/components/Sidebar';
import ChatArea from '../../src/components/ChatArea';
import StoryViewer from '../../src/components/StoryViewer';
import { AuthContext } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatContext } from '../../src/context/ChatContext';
import { useChatActions } from '../../src/context/chat/useChatActions';
import { useChatDrafts } from '../../src/context/chat/useChatDrafts';
import { useChatUiState } from '../../src/context/chat/useChatUiState';
import { useChatRealtime } from '../../src/context/chat/useChatRealtime';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';
import { renderAvatar } from '../../src/context/chat/renderAvatar';
const self = { id: 'self', name: 'Алексей' };
const peer = { id: 'peer', name: 'Анна' };
const noop = () => {};
const initial = () => JSON.parse(localStorage.getItem('operations-messages') || 'null') || [
 { id: 'source', name: 'Разговор', type: 'group', createdBy: self.id, members: [self, peer], settings: {}, messages: [
 { id: 'one', senderId: self.id, senderName: self.name, text: 'Первое сообщение', timestamp: '2026-10-18T10:00:00Z' },
 { id: 'two', senderId: peer.id, senderName: peer.name, text: 'Сообщение Анны', timestamp: '2026-10-18T10:01:00Z' },
 { id: 'three', senderId: self.id, senderName: self.name, text: 'Ещё одно сообщение', timestamp: '2026-10-18T10:02:00Z' }
 ] },
 { id: 'target', name: 'Друзья', type: 'group', createdBy: self.id, members: [self, peer], settings: {}, messages: [] },
 { id: 'saved', name: 'Избранное', type: 'personal', savedMessagesOwnerId: self.id, createdBy: self.id, members: [self], settings: {}, messages: [] }
];
const control = { requests: [], failSend: false, failEdit: false };
window.__messageOperations = control;
dataService.isLive = () => Boolean(control.realtimeEnabled);
const channels = new Set();
supabase.channel = () => {
 const listeners = [];
 const channel = { on: (kind, filter, callback) => { listeners.push({ kind, filter, callback }); return channel; },
  subscribe: () => channel, unsubscribe: () => channels.delete(listeners) };
 channels.add(listeners); return channel;
};
control.emit = (table, event, row) => Promise.all([...channels].flat().filter(listener => listener.kind === 'postgres_changes' && listener.filter.table === table && listener.filter.event === event).map(listener => listener.callback({ new: row })));
control.listenerCount = () => [...channels].flat().filter(listener => listener.filter.table === 'messages').length;
dataService.sendMessage = async (chatId, senderId, text, replyTo, media, id) => {
 control.requests.push({ kind: 'send', chatId, senderId, text, replyTo, media, id });
 if (control.failNetwork) throw new Error('failed to fetch');
 if (control.failSend || control.failSendAt === control.requests.filter(request => request.kind === 'send').length) throw new Error('Тестовая ошибка отправки');
 return { id };
};
dataService.editMessage = async (id, text, revision) => {
 control.requests.push({ kind: 'edit', id, text, revision });
 if (control.failEdit) throw new Error('Тестовая ошибка редактирования');
 return { text, edited_at: new Date().toISOString() };
};
dataService.createChat = async (_userId, target) => {
 control.requests.push({ kind: 'create', target: target.id });
 if (control.failCreate) throw new Error('Тестовая ошибка создания чата');
 return { id: 'story-private', type: 'personal', name: peer.name, members: [self, peer], messages: [], settings: {} };
};
function Harness() {
 const [user, setUser] = useState(self);
 const [chats, setChats] = useState(initial);
 const [queue, setQueue] = useState([]);
 const [activeStoryId, setActiveStoryId] = useState(null);
 const stories = [{ id: 'story-peer', userId: peer.id, userName: peer.name, userAvatar: 'А', media: '/code_story.png', caption: 'Тестовая история' }];
 const ui = useChatUiState(user);
 const { setActiveChatId } = ui;
 const drafts = useChatDrafts(user.id);
 const key = useRef(null); const keys = useRef({});
 control.openStory = async (existing = true) => {
  const sharedKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keys.current['story-private'] = sharedKey; control.storyKey = sharedKey;
  if (existing) setChats(previous => [...previous.filter(chat => chat.id !== 'story-private'),
   { id: 'story-private', type: 'personal', name: peer.name, members: [self, peer], messages: [], settings: {} }]);
  setActiveStoryId('story-peer');
 };
 const typingChannel = useRef(null); const typingTimeouts = useRef({});
 const activeId = useRef(ui.activeChatId); activeId.current = ui.activeChatId;
 const [realtimeEnabled, setRealtimeEnabled] = useState(false);
 const [, setOnline] = useState(new Set()); const [, setTyping] = useState({});
 control.enableRealtime = sharedKey => {
  keys.current.source = sharedKey; control.realtimeEnabled = true;
  setChats(previous => previous.map(chat => chat.id === 'source' ? { ...chat, type: 'personal' } : chat));
  setRealtimeEnabled(true);
 };
 useChatRealtime({ currentUser: realtimeEnabled ? user : null, chats, realtimeChatIds: 'source', setChats,
  fetchChats: noop, fetchStories: noop, markMessagesAsRead: noop, setSharedKeysCache: noop,
  e2eePrivateKeyRef: key, sharedKeysCacheRef: keys, activeChatIdRef: activeId, setActiveChatId,
  setOnlineUsers: setOnline, setTypingStatuses: setTyping, typingChannelRef: typingChannel, typingTimeoutsRef: typingTimeouts });
 const activeChat = chats.find(chat => chat.id === ui.activeChatId);
 const actions = useChatActions({ currentUser: user, chats, setChats, activeChatId: ui.activeChatId,
  setActiveChatId: ui.setActiveChatId, fetchChats: noop, setOfflineQueue: setQueue,
  e2eePrivateKeyRef: key, sharedKeysCacheRef: keys, setSharedKeysCache: noop });
 React.useEffect(() => { setActiveChatId('source'); }, [setActiveChatId]);
 React.useEffect(() => { localStorage.setItem('operations-messages', JSON.stringify(chats)); }, [chats]);
 control.select = ui.setActiveChatId; control.setUser = setUser; control.chats = chats; control.queue = queue;
 control.removeSaved = () => setChats(previous => previous.filter(chat => chat.id !== 'saved'));
 const value = { ...ui, ...actions, ...drafts, currentUser: user, chats, setChats, activeChat,
  renderAvatar, getChatStatus: () => 'Группа', onlineUsers: new Set(), stories, activeStoryId, setActiveStoryId, typingStatuses: {},
  installedStickers: [], sendTypingStatus: noop, viewStory: noop, isOnline: true, isChatLoading: {},
  historyLoadStatus: {}, messagePagination: {}, loadOlderMessages: noop, isSyncing: {} };
 return <AuthContext.Provider value={{ currentUser: user }}><E2EEContext.Provider value={{ sharedKeysCache: {}, setSharedKeysCache: noop, e2eePrivateKey: null }}>
  <ChatContext.Provider value={value}><div className={`app-container${activeChat ? ' active-chat-selected' : ''}`}><Sidebar/><ChatArea/></div><StoryViewer/></ChatContext.Provider>
 </E2EEContext.Provider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
