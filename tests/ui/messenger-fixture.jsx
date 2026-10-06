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
const request = (kind, chatId) => new Promise((resolve, reject) => requests.push({ kind, chatId, resolve, reject, done: false }));
const readCachedMessages = chatId => request('cache', chatId);
dataService.loadChatMessages = chatId => request('network', chatId);
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
  Object.assign(controller, { select: setActiveChatId, user: setCurrentUser, load: loader.loadActiveChatMessages,
    state: { chats, status: loader.historyLoadStatus, loading: loader.isChatLoading, syncing: loader.isSyncing } });
  const dialogs = new URLSearchParams(location.search).has('dialogs');
  const value = { ...ui, ...loader, currentUser, chats, activeChat: chats.find(chat => chat.id === activeChatId),
    setActiveChatId, getChatStatus: () => 'Тестовая история', renderAvatar: () => '👤', wallpaper: 'classic',
    sendMessage: noop, deleteMessage: noop, toggleReaction: noop, typingStatuses: {}, sendTypingStatus: noop,
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
