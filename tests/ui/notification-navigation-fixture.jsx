import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useNotificationNavigation } from '../../src/hooks/useNotificationNavigation';

function Fixture() {
  const [currentUser, setUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  useNotificationNavigation({ currentUser, chats, setActiveChatId });
  window.__notifications = { setUser, setChats, activeChatId, currentUser };
  return <output>{activeChatId || 'none'}</output>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
