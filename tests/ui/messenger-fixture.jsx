import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/SettingsModal.css';
import { AuthContext } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatContext } from '../../src/context/ChatContext';
import { useChatLoader } from '../../src/context/chat/useChatLoader';
import { useChatUiState } from '../../src/context/chat/useChatUiState';
import { dataService } from '../../src/services/dataLayer';
import { saveCachedMessagesBatch, getCachedMessagesForChat, getCachedMessages, getCachedMessagesBeforeTimestamp } from '../../src/utils/indexedDbHelper';
import { createHistorySnapshot } from '../../src/utils/messageHistory';
import ChatArea from '../../src/components/ChatArea';
import NewChatModal from '../../src/components/NewChatModal';
import CreateStoryModal from '../../src/components/CreateStoryModal';
import MediaPickerPanel from '../../src/components/chat/MediaPickerPanel';

const noop = () => {};
const self = { id: 'messenger-self', name: 'Тестовый пользователь', username: 'messenger_self' };
const makeChat = id => ({ id, name: `Chat ${id}`, type: 'group', members: [self], settings: {}, messages: [], unread_count: 0 });
const requests = [];
const controller = {
  requests,
  reactionCalls: [],
  cache: {
    seed: (messages, chatId = 'a', userId = self.id) => saveCachedMessagesBatch(chatId, messages, userId),
    read: (chatId = 'a', userId = self.id) => getCachedMessagesForChat(chatId, userId),
    legacy: (chatId = 'a', userId = self.id) => getCachedMessages(chatId, userId),
    page: (cursor, limit = 30, chatId = 'a', userId = self.id) => getCachedMessagesBeforeTimestamp(chatId, cursor, limit, userId),
    reconcile: (messages, pageSize = 100, chatId = 'a') => saveCachedMessagesBatch(chatId, messages, self.id, createHistorySnapshot(messages, pageSize))
  },
  complete(kind, chatId, messages = [], error = null) {
    const item = requests.find(request => request.kind === kind && request.chatId === chatId && !request.done);
    if (!item) throw new Error(`No ${kind} request for ${chatId}`);
    item.done = true;
    if (error) item.reject(new Error(error)); else item.resolve(messages);
  },
  completeIndex(index, messages = [], error = null) {
    const item = requests[index]; item.done = true;
    if (error) item.reject(new Error(error)); else item.resolve(messages);
  }
};
window.__messengerTest = controller;
const request = (kind, chatId, limit = null, cursor = null) => new Promise((resolve, reject) => requests.push({ kind, chatId, limit, cursor, resolve, reject, done: false }));
const readCachedMessages = chatId => request('cache', chatId);
dataService.loadChatMessages = (chatId, limit, cursor) => request('network', chatId, limit, cursor);
dataService.searchProfiles = async () => [{ id: 'long-peer', username: 'very_long_username', display_name: 'Очень длинное имя собеседника '.repeat(5), avatar: '👤' }];

function Harness() {
  const [currentUser, setCurrentUser] = useState(self);
  const [chats, setChats] = useState(() => ['a', 'b'].map(makeChat));
  const [activeChatId, setActiveChatId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const chatsRef = useRef(chats); chatsRef.current = chats;
  const e2eePrivateKeyRef = useRef(null);
  const sharedKeysCacheRef = useRef({});
  const loader = useChatLoader({ currentUser, setChats, chatsRef, e2eePrivateKeyRef, sharedKeysCacheRef,
    setSharedKeysCache: noop, activeChatId, e2eePrivateKey: null, readCachedMessages });
  const ui = useChatUiState(currentUser);
  Object.assign(controller, { select: setActiveChatId, user: setCurrentUser, load: loader.loadActiveChatMessages, older: loader.loadOlderMessages,
    replaceMessages: (chatId, messages) => setChats(previous => previous.map(chat => chat.id === chatId ? { ...chat, messages } : chat)),
    configureChat: (chatId, changes) => setChats(previous => previous.map(chat => chat.id === chatId ? { ...chat, ...changes } : chat)),
    state: { chats, status: loader.historyLoadStatus, loading: loader.isChatLoading, syncing: loader.isSyncing, pagination: loader.messagePagination } });
  const dialogs = new URLSearchParams(location.search).has('dialogs');
  const toggleReaction = (chatId, messageId, emoji) => {
    controller.reactionCalls.push({ chatId, messageId, emoji });
    setChats(previous => previous.map(chat => chat.id !== chatId ? chat : {
      ...chat,
      messages: chat.messages.map(message => {
        if (message.id !== messageId) return message;
        const existing = message.reactions?.find(reaction => reaction.emoji === emoji);
        const reactions = (message.reactions || []).filter(reaction => reaction.emoji !== emoji);
        if (!existing) reactions.push({ emoji, count: 1, users: [currentUser.id] });
        return { ...message, reactions };
      })
    }));
  };
  const value = { ...ui, ...loader, currentUser, chats, activeChat: chats.find(chat => chat.id === activeChatId),
    setActiveChatId, getChatStatus: () => 'Тестовая история', renderAvatar: () => '👤', wallpaper: 'classic',
    sendMessage: noop, deleteMessage: noop, toggleReaction, typingStatuses: {}, sendTypingStatus: noop,
    retrySendMessage: noop, deleteFailedMessage: noop, isOnline: true, installedStickers: [], createChat: async () => {}, publishStory: async () => {} };
  return <AuthContext.Provider value={{ currentUser }}><E2EEContext.Provider value={{ sharedKeysCache: {}, setSharedKeysCache: noop, e2eePrivateKey: null }}><ChatContext.Provider value={value}>
    {dialogs ? <div style={{ width: '100%', height: '100%' }}>
      <button onClick={() => { ui.setNewChatModalTab('personal'); ui.setIsNewChatOpen(true); }}>Личный чат</button>
      <button onClick={() => { ui.setNewChatModalTab('group'); ui.setIsNewChatOpen(true); }}>Группа</button>
      <button onClick={() => { ui.setNewChatModalTab('channel'); ui.setIsNewChatOpen(true); }}>Канал</button>
      <button onClick={() => ui.setIsCreateStoryOpen(true)}>История</button>
      <div style={{ position: 'fixed', bottom: 16, right: 24 }}><div className="emoji-wrapper">
        <button className="emoji-trigger" aria-label="Смайлы" onClick={() => setPickerOpen(previous => !previous)}>☺</button>
        <MediaPickerPanel isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onSelectEmoji={noop} onSelectSticker={noop} onSelectGif={noop} />
      </div></div>
      {ui.isNewChatOpen && <NewChatModal />}
      {ui.isCreateStoryOpen && <CreateStoryModal />}
    </div> : <div className={`app-container${activeChatId ? ' active-chat-selected' : ''}`}><ChatArea /></div>}
  </ChatContext.Provider></E2EEContext.Provider></AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness />);
