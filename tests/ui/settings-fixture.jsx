import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { AuthContext } from '../../src/context/AuthContext';
import { E2EEContext } from '../../src/context/E2EEContext';
import ChatHeader from '../../src/components/chat/ChatHeader';
import { renderAvatar } from '../../src/context/chat/renderAvatar';
import '../../src/components/ChatArea.css';
import { ChatContext } from '../../src/context/ChatContext';
import { useChatUiState } from '../../src/context/chat/useChatUiState';
import { supabase } from '../../src/supabaseClient';
import SettingsModal from '../../src/components/SettingsModal';
import NewChatModal from '../../src/components/NewChatModal';
import CreateStoryModal from '../../src/components/CreateStoryModal';

const initialUser = {
  id: 'settings-fixture', name: 'Тестовый пользователь', username: 'settings_user', bio: 'Описание',
  email: 'saved@example.test', theme: 'telegram-blue', wallpaper: 'classic', notificationsEnabled: true,
  has_e2ee: true, public_key: 'fixture-public-key-only', avatarColor: '#2481cc'
};
const requests = [];
const controller = {
  requests,
  resolve(index, error = null) { requests[index].resolve(error ? { error: new Error(error) } : { data: true }); },
};
window.__settingsTest = controller;
const request = (kind, fields) => new Promise(resolve => { requests.push({ kind, fields, resolve }); });
supabase.auth.updateUser = fields => request('password', fields);

function Harness() {
  const [currentUser, setCurrentUser] = useState(initialUser);
  const ui = useChatUiState(currentUser);
  Object.assign(controller, { open: ui.openSettings, user: currentUser, setUser: setCurrentUser, ui });
  const updateProfile = async fields => {
    const result = await request('profile', fields);
    if (!result.error) setCurrentUser(previous => ({ ...previous, ...fields }));
    return result;
  };
  const updateEmail = email => request('email', { email });
  return <AuthContext.Provider value={{ currentUser, setCurrentUser, updateProfile, updateEmail, logOut: async () => { controller.loggedOut = true; } }}>
    <E2EEContext.Provider value={{ e2eePrivateKey: { fixture: true }, sharedKeysCache: {}, resetE2EE: async () => { controller.keyReset = true; return false; } }}><ChatContext.Provider value={{ ...ui, currentUser, chats: [], renderAvatar,
      installedStickers: [{ id: 'one', title: 'Очень длинное название набора '.repeat(8), stickers: [] }],
      importStickerPack: async () => ({ title: 'Набор' }), createChat: async () => {}, publishStory: async () => {} }}>
      <div style={{ width: '100%', minWidth: 0 }}>
      <ChatHeader activeChat={{ id: 'fixture-chat', type: 'personal', name: 'Очень длинное имя собеседника '.repeat(20), members: [initialUser, { id: 'peer', hasE2ee: true }] }}
        renderAvatar={renderAvatar} getChatStatus={() => 'Был в сети недавно'} setIsInfoOpen={() => {}} setActiveChatId={() => {}} />
      <button onClick={() => ui.openSettings()}>Открыть настройки</button>
      <button onClick={() => ui.openSettings('security')}>Открыть безопасность</button>
      <button onClick={() => ui.setIsNewChatOpen(true)}>Создать чат</button>
      <button onClick={() => ui.setIsCreateStoryOpen(true)}>Создать историю</button>
      {ui.isSettingsOpen && <SettingsModal />}
      {ui.isNewChatOpen && <NewChatModal />}
      {ui.isCreateStoryOpen && <CreateStoryModal />}
      </div>
    </ChatContext.Provider></E2EEContext.Provider>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Harness />);
