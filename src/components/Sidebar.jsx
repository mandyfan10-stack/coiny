import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '../context/ChatContext';
import { dataService } from '../services/dataLayer';
import { Menu, Search, Pin, VolumeX, MessageSquare, User, Users, Megaphone, MessageSquarePlus, Eye, Plus, Lock, WifiOff } from 'lucide-react';
import { isSavedMessagesChat } from '../utils/savedMessages';
import { chatAvatarFallback, personAvatarFallback } from '../context/chat/avatarFallback';
import { triggerHaptic } from '../hooks/useMessageTouch';


export default function Sidebar() {
  const {
    chats,
    onlineUsers,
    activeChatId,
    setActiveChatId,
    searchQuery,
    setSearchQuery,
    activeFolder,
    setActiveFolder,
    stories,
    viewStory,
    currentUser,
    setIsNewChatOpen,
    typingStatuses,
    setIsCreateStoryOpen,
    setIsDrawerOpen,
    setNewChatModalTab,
    renderAvatar,
    createChat,
    setIsInfoOpen,
    isOnline
  } = useChat();

  const [globalResults, setGlobalResults] = useState([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [showMyStoriesMenu, setShowMyStoriesMenu] = useState(false);
  const [openingProfileId, setOpeningProfileId] = useState(null);
  const storiesTrayRef = useRef(null);

  // Translate vertical wheel scroll to horizontal scroll on stories tray
  useEffect(() => {
    const el = storiesTrayRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = () => {
      setShowMyStoriesMenu(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, []);

  // Debounced global profile search
  useEffect(() => {
    const cleanQuery = searchQuery.trim().replace(/^@+/, '');
    if (!currentUser || cleanQuery.length < 2) {
      setGlobalResults([]);
      setGlobalLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    setGlobalLoading(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const profiles = await dataService.searchProfiles(cleanQuery, currentUser.id, 10, controller.signal);
        if (!cancelled) setGlobalResults(profiles);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Global search failed:', error);
        if (!cancelled) setGlobalResults([]);
      } finally {
        if (!cancelled) setGlobalLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [searchQuery, currentUser]);
  const handleSelectGlobalUser = async (user) => {
    if (openingProfileId) return;
    const existingChat = chats.find(chat => (
      chat.type === 'personal' && chat.members?.some(member => member.id === user.id)
    ));
    if (existingChat) {
      setActiveChatId(existingChat.id);
      setIsInfoOpen(true);
      setSearchQuery('');
      setGlobalResults([]);
      return;
    }
    setOpeningProfileId(user.id);
    try {
      const chat = await createChat(user, 'personal');
      if (chat) {
        setActiveChatId(chat.id);
        setIsInfoOpen(true);
        setSearchQuery('');
        setGlobalResults([]);
      }
    } finally {
      setOpeningProfileId(null);
    }
  };

  // Filter chats by folder and query
  const filteredChats = chats.filter(chat => {
    // 1. Filter by Folder
    if (activeFolder === 'personal' && chat.type !== 'personal') return false;
    if (activeFolder === 'groups' && chat.type !== 'group') return false;
    if (activeFolder === 'channels' && chat.type !== 'channel') return false;

    // 2. Filter by Search Query
    if (searchQuery.trim() === '') return true;
    const query = searchQuery.toLowerCase().replace('@', '');
    const nameMatch = chat.name.toLowerCase().includes(query);
    const usernameMatch = chat.username && chat.username.toLowerCase().includes(query);
    const msgMatch = chat.messages.some(m => m.text.toLowerCase().includes(query));
    return nameMatch || usernameMatch || msgMatch;
  });

  // Sort chats: pinned first, then by last message timestamp
  const sortedChats = [...filteredChats].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    
    const aLastMsg = a.messages[a.messages.length - 1];
    const bLastMsg = b.messages[b.messages.length - 1];
    if (!aLastMsg) return 1;
    if (!bLastMsg) return -1;
    return new Date(bLastMsg.timestamp) - new Date(aLastMsg.timestamp);
  });

  const getFormatTime = (dateObj) => {
    const d = new Date(dateObj);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getFolderIcon = (folder) => {
    switch (folder) {
      case 'all': return <MessageSquare size={16} />;
      case 'personal': return <User size={16} />;
      case 'groups': return <Users size={16} />;
      case 'channels': return <Megaphone size={16} />;
      default: return null;
    }
  };

  return (
    <aside className="sidebar">
      {/* Top Header */}
      <div className="sidebar-header">
        <button
          className="menu-btn"
          onClick={() => {
            triggerHaptic(8);
            setIsDrawerOpen(true);
          }}
          title="Настройки"
        >
          <Menu size={22} />
        </button>
        <div className="search-container">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Поиск чатов и сообщений..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          className="menu-btn"
          onClick={() => {
            triggerHaptic(8);
            setNewChatModalTab('personal');
            setIsNewChatOpen(true);
          }}
          title="Новый чат"
        >
          <MessageSquarePlus size={22} />
        </button>
      </div>
      {!isOnline && (
        <div className="offline-banner" style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <WifiOff size={14} className="offline-banner-icon" />
          <span>Соединение потеряно...</span>
        </div>
      )}

      {/* Folders Navigation */}
      <div className="folders-nav">
        {[
          { id: 'all', name: 'Все' },
          { id: 'personal', name: 'Личные' },
          { id: 'groups', name: 'Группы' },
          { id: 'channels', name: 'Каналы' }
        ].map(folder => (
          <button
            key={folder.id}
            className={`folder-tab ${activeFolder === folder.id ? 'active' : ''}`}
            onClick={() => {
              triggerHaptic(6);
              setActiveFolder(folder.id);
            }}
          >
            {getFolderIcon(folder.id)}
            <span>{folder.name}</span>
          </button>
        ))}
      </div>

      {/* Stories Tray */}
      <div className="stories-tray" ref={storiesTrayRef}>
        {(() => {
          const myStoriesList = stories.filter(s => s.userId === currentUser?.id);
          const hasMyStories = myStoriesList.length > 0;
          const hasUnviewedMyStories = myStoriesList.some(s => !s.viewed);
          
          return (
            <div 
              className="story-item current-user-story" 
              style={{ position: 'relative', minWidth: '72px' }}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic(10);
                if (hasMyStories) {
                  setShowMyStoriesMenu(prev => !prev);
                } else {
                  setIsCreateStoryOpen(true);
                }
              }}
            >
              <div className={`story-avatar-wrapper ${hasMyStories ? (hasUnviewedMyStories ? 'unviewed' : 'viewed') : 'plus-icon'}`}>
                <div className="story-avatar-initials" style={{ padding: 0 }}>{renderAvatar(currentUser?.avatar, personAvatarFallback(currentUser))}</div>
              </div>
              <span className="story-username" style={{ whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' }}>Моя история</span>
            </div>
          );
        })()}
        
        {(() => {
          const otherStories = stories.filter(s => s.userId !== currentUser?.id);
          const groupedStories = [];
          const seenUsers = new Set();

          for (const story of otherStories) {
            if (!seenUsers.has(story.userId)) {
              seenUsers.add(story.userId);
              const userStories = otherStories.filter(s => s.userId === story.userId);
              const hasUnviewed = userStories.some(s => !s.viewed);
              const storyToOpen = userStories.find(s => !s.viewed) || userStories[0];
              
              groupedStories.push({
                ...story,
                hasUnviewed,
                storyToOpenId: storyToOpen.id
              });
            }
          }

          return groupedStories.map(story => (
            <div
              key={story.userId}
              className={`story-item ${story.hasUnviewed ? 'unviewed' : 'viewed'}`}
              onClick={() => {
                triggerHaptic(8);
                viewStory(story.storyToOpenId);
              }}
            >
              <div className="story-avatar-wrapper">
                <div className="story-avatar-initials" style={{ padding: 0 }}>{renderAvatar(story.userAvatar, personAvatarFallback(story))}</div>
              </div>
              <span className="story-username">{story.userName}</span>
            </div>
          ));
        })()}
      </div>

      {/* Chat List */}
      <div className="chat-list">
        {searchQuery.trim() !== '' && (
          <div className="search-section-header" style={{ padding: '8px 16px 4px 16px', fontSize: '11px', fontWeight: '600', color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Чаты и контакты
          </div>
        )}

        {sortedChats.length === 0 ? (
          <div className="no-chats" style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>Ничего не найдено</div>
        ) : (
          sortedChats.map(chat => {
            const lastMsg = chat.messages[chat.messages.length - 1];
            const isActive = chat.id === activeChatId;
            const unreadCount = typeof chat.unread_count === 'number'
              ? chat.unread_count
              : (Array.isArray(chat.messages) ? chat.messages : []).filter(
                  m => m.senderId !== currentUser?.id && m.senderId !== 'current' && !m.read
                ).length;

            const otherMember = chat.type === 'personal'
              ? chat.members?.find(m => m.id !== currentUser?.id)
              : null;
            const isOnline = otherMember && onlineUsers.has(otherMember.id);

            const typingUsers = typingStatuses[chat.id] ? Object.values(typingStatuses[chat.id]) : [];
            const isTypingText = typingUsers.length > 0
              ? `${typingUsers.join(', ')} ${typingUsers.length > 1 ? 'печатают' : 'печатает'}...`
              : null;

            return (
              <div
                key={chat.id}
                className={`chat-item ${isActive ? 'active' : ''}`}
                data-chat-id={chat.id}
                data-chat-username={chat.username || undefined}
                onClick={() => {
                  triggerHaptic(8);
                  setActiveChatId(chat.id);
                }}
              >
                {/* Avatar */}
                <div className="chat-avatar">
                  {renderAvatar(chat.avatar, chatAvatarFallback(chat))}
                  {isOnline && <span className="online-badge" />}
                </div>

                {/* Info info */}
                <div className="chat-info-block">
                  <div className="chat-info-header">
                    <span className="chat-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      {chat.name}
                      {chat.type === 'personal' && (
                        <Lock size={12} className="e2ee-sidebar-lock-icon" title="Сквозное шифрование" style={{ marginLeft: '4px', verticalAlign: 'middle', display: 'inline-block' }} />
                      )}
                    </span>
                    <span className="chat-time">
                      {lastMsg ? getFormatTime(lastMsg.timestamp) : ''}
                    </span>
                  </div>

                  <div className="chat-info-body">
                    <p className="chat-last-message">
                      {isTypingText ? (
                        <span className="typing-indicator-sidebar">{isTypingText}</span>
                      ) : lastMsg ? (
                        <>
                          {(lastMsg.senderId === currentUser?.id || lastMsg.senderId === 'current') && <span className="you-prefix">Вы: </span>}
                          {lastMsg.text}
                        </>
                      ) : (
                        <span className="empty-chat-msg">Нет сообщений</span>
                      )}
                    </p>

                    <div className="chat-badges">
                      {!(isSavedMessagesChat(chat) && !lastMsg) && !chat.notifications && (
                        <VolumeX size={14} className="mute-icon" />
                      )}
                      {!(isSavedMessagesChat(chat) && !lastMsg) && chat.pinned && (
                        <Pin size={14} className="pinned-icon" />
                      )}
                      {unreadCount > 0 && (
                        <span className="unread-badge">{unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {searchQuery.trim() !== '' && (
          <>
            <div className="search-section-header" style={{ padding: '16px 16px 4px 16px', borderTop: '1px solid var(--border-color)', marginTop: '8px', fontSize: '11px', fontWeight: '600', color: 'var(--accent-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Глобальный поиск
            </div>
            
            {globalLoading ? (
              <div className="search-status" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                <div className="spinner" style={{ width: '16px', height: '16px', border: '2px solid var(--border-color)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span>Ищем в сети...</span>
              </div>
            ) : globalResults.length === 0 ? (
              <div className="no-chats" style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {searchQuery.trim().replace(/^@+/, '').length < 2 ? 'Введите не менее 2 символов' : 'Пользователи не найдены'}
              </div>
            ) : (
              globalResults.map(user => (
                <button
                  type="button"
                  key={user.id}
                  className="chat-item global-search-result"
                  onClick={() => handleSelectGlobalUser(user)}
                  disabled={openingProfileId === user.id}
                >
                  <div className="chat-avatar">{renderAvatar(user.avatar, personAvatarFallback(user))}</div>
                  <div className="chat-info-block">
                    <div className="chat-info-header">
                      <span className="chat-name">{user.display_name || user.username}</span>
                    </div>
                    <div className="chat-info-body">
                      <p className="chat-last-message" style={{ color: 'var(--accent-color)' }}>
                        @{user.username}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </>
        )}
      </div>

      {showMyStoriesMenu && (() => {
        const myStoriesList = stories.filter(s => s.userId === currentUser?.id);
        return (
          <div className="my-stories-dropdown" style={{ top: '172px', left: '12px' }} onClick={(e) => e.stopPropagation()}>
            <button 
              type="button"
              className="my-stories-dropdown-btn" 
              onClick={() => {
                setShowMyStoriesMenu(false);
                const storyToOpen = myStoriesList.find(s => !s.viewed) || myStoriesList[0];
                if (storyToOpen) viewStory(storyToOpen.id);
              }}
            >
              <Eye size={16} /> Посмотреть
            </button>
            <button 
              type="button"
              className="my-stories-dropdown-btn" 
              onClick={() => {
                setShowMyStoriesMenu(false);
                setIsCreateStoryOpen(true);
              }}
            >
              <Plus size={16} /> Добавить
            </button>
          </div>
        );
      })()}
    </aside>
  );
}
