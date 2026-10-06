import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { AuthProvider } from '../../src/context/AuthContext.jsx';
import { E2EEProvider } from '../../src/context/E2EEContext.jsx';
import { ChatContext } from '../../src/context/ChatContext.jsx';
import ChatArea from '../../src/components/ChatArea.jsx';

const self = { id: 'scroll-self', username: 'scroll_self', name: 'Scroll Self', has_e2ee: false };
localStorage.setItem('tg-user-mock', JSON.stringify(self));
const noop = () => {};
const makeMessage = (chatId, index) => ({
  id: `${chatId}-msg-${index}`,
  senderId: 'scroll-peer',
  senderName: 'Scroll Peer',
  text: `Message ${index}\n` + Array.from({ length: 1 + Math.abs(index % 7) }, (_, line) => `Line ${line}: scroll regression history.`).join('\n'),
  timestamp: new Date(Date.UTC(2026, 9, 1, 0, index + 30)).toISOString(),
  read: true,
  reactions: [],
});
const makeChat = (id, count) => ({
  id, name: `Chat ${id}`, type: 'personal', unread_count: 0,
  members: [self, { id: 'scroll-peer', hasE2ee: false }], settings: {},
  messages: Array.from({ length: count }, (_, index) => makeMessage(id, index)),
});

function Harness() {
  const [chats, setChats] = useState([makeChat('a', 200), makeChat('b', 120)]);
  const [activeChatId, setActiveChatId] = useState('a');
  const activeChat = chats.find(chat => chat.id === activeChatId);
  useEffect(() => {
    window.__scrollTest = {
      select: setActiveChatId,
      requests: [],
      resolveNext(chatId) {
        const request = this.requests.find(item => item.chatId === chatId && !item.done);
        if (!request) throw new Error(`No pending history request for ${chatId}`);
        request.done = true;
        setChats(previous => previous.map(chat => chat.id === chatId ? {
          ...chat, messages: [...Array.from({ length: 30 }, (_, index) => makeMessage(chatId, index - 30)), ...chat.messages],
        } : chat));
        request.resolve(30);
      },
      append(chatId) {
        setChats(previous => previous.map(chat => chat.id === chatId ? {
          ...chat, messages: [...chat.messages, makeMessage(chatId, chat.messages.length)],
        } : chat));
      },
      expand(chatId, messageId) {
        // Simulates a row growing after media decoding without changing its ID.
        setChats(previous => previous.map(chat => chat.id === chatId ? {
          ...chat, messages: chat.messages.map(message => message.id === messageId ? {
            ...message, text: message.text + '\n' + 'Decoded media height\n'.repeat(20),
          } : message),
        } : chat));
      },
      attachImage(chatId, messageId) {
        setChats(previous => previous.map(chat => chat.id === chatId ? {
          ...chat, messages: chat.messages.map(message => message.id === messageId ? {
            ...message, text: '[Фото]', media: `${location.origin}/scroll-image.svg`,
          } : message),
        } : chat));
      },
    };
    return () => { delete window.__scrollTest; };
  }, []);

  const loadOlderMessages = chatId => new Promise(resolve => {
    window.__scrollTest.requests.push({ chatId, resolve, done: false });
  });
  const value = {
    activeChat, chats, setActiveChatId, getChatStatus: () => 'Scroll test',
    sendMessage: noop, deleteMessage: noop, toggleReaction: noop,
    isInfoOpen: false, setIsInfoOpen: noop, typingStatuses: {}, sendTypingStatus: noop,
    wallpaper: 'classic', renderAvatar: () => '👤', installedStickers: [], isOnline: true,
    retrySendMessage: noop, deleteFailedMessage: noop, loadOlderMessages,
    messagePagination: Object.fromEntries(chats.map(chat => [chat.id, { hasMore: chat.messages[0].id === `${chat.id}-msg-0` }])),
    isChatLoading: {}, isSyncing: {}, setIsSettingsOpen: noop, setSettingsTab: noop,
  };
  return <ChatContext.Provider value={value}><div className="app-container"><ChatArea /></div></ChatContext.Provider>;
}

createRoot(document.getElementById('root')).render(<AuthProvider><E2EEProvider><Harness /></E2EEProvider></AuthProvider>);
