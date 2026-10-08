import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/SettingsModal.css';
import { AuthContext } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import { ChatContext } from '../../src/context/ChatContext';
import { useChatUiState } from '../../src/context/chat/useChatUiState';
import { renderAvatar } from '../../src/context/chat/renderAvatar';
import { toggleUserReaction } from '../../src/utils/reactionUtils';
import Sidebar from '../../src/components/Sidebar';
import ChatArea from '../../src/components/ChatArea';
import MainMenuDrawer from '../../src/components/MainMenuDrawer';
import SettingsModal from '../../src/components/SettingsModal';
import NewChatModal from '../../src/components/NewChatModal';
import { dataService } from '../../src/services/dataLayer';
import { CallContext } from '../../src/context/calls/CallProvider';
import ChatInfo from '../../src/components/ChatInfo';
import AuthScreen from '../../src/components/AuthScreen';
import E2EESetupModal from '../../src/components/E2EESetupModal';
import StoryViewer from '../../src/components/StoryViewer';
import CreateStoryModal from '../../src/components/CreateStoryModal';
import CallOverlay from '../../src/components/call/CallOverlay';
import AppUpdateModal from '../../src/components/AppUpdateModal';

const noop = () => {};
const surface = new URLSearchParams(location.search).get('surface');
const requests = [];
const action = (kind, fields) => { requests.push({ kind, fields }); return Promise.resolve({ error: null, success: true }); };
const self = { id: 'preview-self', name: 'Михаил', username: 'mikhail', avatar: 'Михаил', bio: '', theme: 'telegram-blue', wallpaper: 'classic', notifications: true };
const anna = { id: 'preview-anna', name: 'Анна', display_name: 'Анна', avatar: 'Анна', username: 'anna' };
const oleg = { id: 'preview-oleg', name: 'Олег', display_name: 'Олег', avatar: 'Олег', username: 'oleg' };
dataService.searchProfiles = async () => [anna, oleg];
dataService.createChatInvite = async () => ({ token: 'preview-invite' });
const message = (id, text, sender = anna, minute = 17, extra = {}) => ({
  id, text, senderId: sender.id, senderName: sender.name,
  timestamp: new Date(2026, 9, 8, 10, minute).toISOString(), read: true, ...extra
});
const samples = [
  message('intro', 'Привет! Собрала всё в одном месте. Посмотри, когда будет удобно.'),
  message('answer', 'Спасибо, сейчас посмотрю.', self, 18),
  message('photo', 'Моё рабочее место. Теперь можно спокойно закончить проект.', anna, 19, { media: '/code_story.png', reactions: [{ emoji: '👍', count: 2, users: [self.id, oleg.id] }] }),
  message('requirements', 'Хочется простого интерфейса: понятные кнопки, удобный поиск и ничего лишнего.', anna, 20),
  message('reply', 'Согласен. Оставим привычное расположение элементов.', self, 21, { replyTo: 'requirements' }),
  message('last', 'Отлично! Тогда продолжим после обеда.', anna, 22)
];
const chat = (id, name, type = 'personal', messages = [], extra = {}) => ({
  id, name, type, avatar: type === 'group' ? 'group' : type === 'channel' ? 'channel' : name,
  members: [self, anna, oleg], messages, settings: {}, unread_count: 0, notifications: true, ...extra
});
const initialChats = [
  chat('design', 'Дизайн приложения', 'group', samples, { pinned: true }),
  chat('anna', 'Анна', 'personal', [message('anna-last', 'Давай созвонимся вечером', anna, 16)], { unread_count: 2 }),
  chat('saved', 'Избранное', 'personal', [message('saved-last', 'https://desktop.telegram.org/', self, 12)], { avatar: 'saved', savedMessagesOwnerId: self.id, createdBy: self.id, members: [self] }),
  chat('team', 'Команда Coiny', 'group', [message('team-last', 'Олег: Сборка готова', oleg, 8)], { unread_count: 12 }),
  chat('oleg', 'Олег', 'personal', [message('oleg-last', 'Спасибо!', oleg, 5)]),
  chat('news', 'Новости проекта', 'channel', [message('news-last', 'Обновление интерфейса', anna, 1)], { notifications: false, unread_count: 1 }),
  chat('weekend', 'Планы на выходные', 'group', [message('weekend-last', 'Встречаемся в субботу?', anna, 0)]),
  chat('long', 'Обсуждение дизайна с очень длинным названием', 'group', [message('long-last', 'Все материалы в закреплённом сообщении', oleg, 0)])
];

function Harness() {
  const [currentUser, setCurrentUser] = useState({ ...self, has_e2ee: surface === 'unlock' });
  const [chats, setChats] = useState(initialChats);
  const [activeStoryId, setActiveStoryId] = useState(null);
  const [callState, setCallState] = useState({ status: 'idle' });
  const [updateOpen, setUpdateOpen] = useState(surface === 'update');
  const [setupRequired, setSetupRequired] = useState(surface === 'setup');
  const [privateKey, setPrivateKey] = useState(null);
  const stories = [{ id: 'anna-story', userId: anna.id, userName: anna.name, userAvatar: anna.avatar,
    viewed: false, media: '/code_story.png', caption: 'Рабочее место', timestamp: 'Сегодня', views: [] }];
  const ui = useChatUiState(currentUser);
  const { setActiveChatId } = ui;
  const activeChat = chats.find(item => item.id === ui.activeChatId);
  const updateMessages = (chatId, update) => setChats(previous => previous.map(item => item.id === chatId ? { ...item, messages: update(item.messages) } : item));
  const updateProfile = async patch => { setCurrentUser(previous => ({ ...previous, ...patch })); return { ...currentUser, ...patch }; };
  const value = {
    ...ui, chats, activeChat, currentUser, renderAvatar, isOnline: true, onlineUsers: new Set([anna.id]),
    getChatStatus: item => item.type === 'group' ? '3 участника' : 'был(а) недавно',
    stories, activeStoryId, setActiveStoryId,
    typingStatuses: {}, installedStickers: [], isChatLoading: {}, isSyncing: {},
    historyLoadStatus: Object.fromEntries(chats.map(item => [item.id, 'loaded'])), messagePagination: {},
    loadActiveChatMessages: noop, loadOlderMessages: noop, sendTypingStatus: noop,
    viewStory: setActiveStoryId, deleteStory: () => setActiveStoryId(null),
    createChat: async (name, type) => { requests.push({ kind: 'createChat', name, type }); return { id: 'created' }; }, importStickerPack: noop,
    deleteChat: noop, clearChatMessages: noop, updateChatAvatar: noop, updateChatSettings: noop, addMemberToChat: noop, toggleMemberRole: noop, openUserProfile: noop,
    addStory: async fields => { requests.push({ kind: 'story', fields }); },
    openSavedMessages: () => ui.setActiveChatId('saved'),
    sendMessage: (text, replyTo, media) => updateMessages(activeChat.id, previous => [...previous, message('sent-' + previous.length, text, self, 23, { replyTo, media })]),
    deleteMessage: (chatId, id) => updateMessages(chatId, previous => previous.filter(item => item.id !== id)),
    toggleReaction: (chatId, id, emoji) => updateMessages(chatId, previous => previous.map(item => item.id === id ? { ...item, reactions: toggleUserReaction(item.reactions, emoji, self.id) } : item)),
    retrySendMessage: noop, deleteFailedMessage: noop
  };
  const startCall = (chatId = 'anna') => setCallState({ status: 'connected', webrtcState: 'connected', chatId, type: 'personal', muted: false });
  const calls = { callState, startCall, endCall: () => setCallState({ status: 'idle' }), rejectCall: () => setCallState({ status: 'idle' }),
    acceptCall: () => startCall(), toggleCallMute: () => setCallState(previous => ({ ...previous, muted: !previous.muted })),
    retryCallConnection: noop, toggleCallVideo: noop, toggleCallScreenShare: noop, toggleVoiceEnhancement: noop,
    groupCallParticipants: [], clearMediaError: noop, voiceEnhancementEnabled: false };
  window.__interfaceTest = { select: ui.setActiveChatId, setTheme: ui.setTheme, setDark: ui.setIsDarkMode, setChats, setUser: setCurrentUser,
    openSettings: ui.openSettings, openInfo: () => ui.setIsInfoOpen(true), startCall, setCallState, openStory: () => setActiveStoryId('anna-story'), requests };
  React.useEffect(() => {
    if (!new URLSearchParams(location.search).has('list')) setActiveChatId('design');
  }, [setActiveChatId]);
  return <AuthContext.Provider value={{ currentUser, authLoading: false, updateProfile, updateEmail: noop, logOut: noop,
    signInWithIdentifier: (identifier, password) => action('login', { identifier, password }),
    signUpWithUsername: (username, password, name) => action('register', { username, password, name }),
    resetPasswordForEmail: identifier => action('recovery', { identifier }) }}>
    <E2EEContext.Provider value={{ sharedKeysCache: {}, setSharedKeysCache: noop, e2eePrivateKey: privateKey, isE2EESetupRequired: setupRequired,
      setupE2EE: async password => { await action('setup', { password }); setSetupRequired(false); return { success: true }; },
      unlockE2EE: async password => { await action('unlock', { password }); setPrivateKey({}); return true; }, resetE2EE: noop }}>
      <ChatContext.Provider value={value}>
        <CallContext.Provider value={calls}>
          {surface === 'auth' ? <AuthScreen /> : <>
            <div className={`app-container${activeChat ? ' active-chat-selected' : ''}`}><Sidebar /><ChatArea /><ChatInfo /></div>
            <MainMenuDrawer />
            {ui.isSettingsOpen && <SettingsModal />}
            {ui.isNewChatOpen && <NewChatModal />}
            {ui.isCreateStoryOpen && <CreateStoryModal />}
            <StoryViewer />
            <E2EESetupModal />
            <CallOverlay />
            <AppUpdateModal show={updateOpen} onClose={() => setUpdateOpen(false)} currentVersion="preview" releaseInfo={{ tagName: 'preview', downloadUrl: 'https://github.com/mandyfan10-stack/coiny/releases', body: 'Обновлён интерфейс приложения.\n'.repeat(12) }} />
          </>}
        </CallContext.Provider>
      </ChatContext.Provider>
    </E2EEContext.Provider>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness />);
