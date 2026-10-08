import Button from './ui/Button';
import IconButton from './ui/IconButton';
import SearchField from './ui/SearchField';
import './NewChatModal.css';
import React, { useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { dataService } from '../services/dataLayer';
import { X, Users, MessageSquare } from 'lucide-react';
import { personAvatarFallback } from '../context/chat/avatarFallback';


export default function NewChatModal() {
  const {
    isNewChatOpen,
    setIsNewChatOpen,
    createChat,
    setIsInfoOpen,
    currentUser,
    newChatModalTab,
    renderAvatar
  } = useChat();

  const [searchQuery, setSearchQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // States for inviting members
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState([]);

  // Debounced search effect for personal chat tab
  useEffect(() => {
    const cleanQuery = searchQuery.trim().replace(/^@+/, '');
    if (!currentUser || !isNewChatOpen || newChatModalTab !== 'personal' || !cleanQuery) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const profiles = await dataService.searchProfiles(cleanQuery, currentUser.id, 10, controller.signal);
        if (!cancelled) setResults(profiles);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Search failed:', error);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [searchQuery, newChatModalTab, currentUser, isNewChatOpen]);
  // Debounced search effect for members to invite (group/channel tabs)
  useEffect(() => {
    const cleanQuery = memberSearchQuery.trim().replace(/^@+/, '');
    const supportsMembers = newChatModalTab === 'group' || newChatModalTab === 'channel';
    if (!currentUser || !isNewChatOpen || !supportsMembers || !cleanQuery) {
      setMemberResults([]);
      setMemberLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    setMemberLoading(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const profiles = await dataService.searchProfiles(cleanQuery, currentUser.id, 10, controller.signal);
        if (!cancelled) setMemberResults(profiles);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Member search failed:', error);
        if (!cancelled) setMemberResults([]);
      } finally {
        if (!cancelled) setMemberLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(delayDebounceFn);
      controller.abort();
    };
  }, [memberSearchQuery, newChatModalTab, currentUser, isNewChatOpen]);
  // Clean form when modal closes/opens or tab changes
  useEffect(() => {
    if (!isNewChatOpen) {
      setSearchQuery('');
      setGroupName('');
      setChannelName('');
      setResults([]);
      setMemberSearchQuery('');
      setMemberResults([]);
      setSelectedMembers([]);
      setCreating(false);
      setCreateError('');
    }
  }, [isNewChatOpen, newChatModalTab]);

  if (!currentUser) return null;

  const handleSelectUser = async (user) => {
    setIsNewChatOpen(false);
    const chat = await createChat(user, 'personal');
    if (chat) {
      setIsInfoOpen(true);
    }
  };

  const handleCreateGroupSubmit = async (e) => {
    e.preventDefault();
    if (!groupName.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const chat = await createChat(groupName.trim(), 'group', selectedMembers);
      if (chat) setIsNewChatOpen(false);
      else setCreateError('Не удалось создать группу. Повторите попытку.');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateChannelSubmit = async (e) => {
    e.preventDefault();
    if (!channelName.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const chat = await createChat(channelName.trim(), 'channel', selectedMembers);
      if (chat) setIsNewChatOpen(false);
      else setCreateError('Не удалось создать канал. Повторите попытку.');
    } finally {
      setCreating(false);
    }
  };

  const getTitle = () => {
    if (newChatModalTab === 'group') return 'Создать группу';
    if (newChatModalTab === 'channel') return 'Создать канал';
    return 'Новый чат';
  };

  return (
    <div className={`settings-modal-overlay ${isNewChatOpen ? 'open' : ''}`}>
      <div className="new-chat-container">
        {/* Header */}
        <div className="settings-header">
          <h3>{getTitle()}</h3>
          <IconButton label="Закрыть создание чата" className="settings-close-btn" onClick={() => setIsNewChatOpen(false)}>
            <X size={20} />
          </IconButton>
        </div>

        {/* Body */}
        <div className="new-chat-body">
          {createError && <div className="auth-error-alert">{createError}</div>}
          {newChatModalTab === 'personal' && (
            <div className="personal-chat-search">
              <SearchField label="Поиск пользователей" className="search-container modal-search"
                  placeholder="Введите имя или никнейм пользователя..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
              />

              {/* Results list */}
              <div className="search-results-list">
                {loading ? (
                  <div className="search-status">
                    <div className="spinner" style={{ width: '22px', height: '22px', borderColor: 'var(--text-secondary)', borderTopColor: 'var(--accent-color)' }} />
                    <span>Поиск пользователей...</span>
                  </div>
                ) : searchQuery.trim() === '' ? (
                  <div className="search-status-info">
                    <MessageSquare size={32} className="info-icon" />
                    <p>Начните вводить никнейм, чтобы найти собеседника</p>
                  </div>
                ) : results.length === 0 ? (
                  <div className="search-status">
                    <span>Пользователь не найден</span>
                  </div>
                ) : (
                  results.map(user => (
                    <button
                      type="button"
                      key={user.id}
                      className="search-user-item"
                      onClick={() => handleSelectUser(user)}
                    >
                      <div className="chat-avatar">{renderAvatar(user.avatar, personAvatarFallback(user))}</div>
                      <div className="search-user-info">
                        <span className="search-user-name">
                          {user.display_name || user.username}
                        </span>
                        <span className="search-user-username">@{user.username}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {newChatModalTab === 'group' && (
            <form onSubmit={handleCreateGroupSubmit} className="group-chat-create-form">
              <div className="input-group">
                <label htmlFor="groupName">Название группового чата *</label>
                <input
                  id="groupName"
                  type="text"
                  placeholder="Например: Обсуждение проекта 🚀"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Invite Members section */}
              <div className="input-group">
                <label>Пригласить участников</label>
                {selectedMembers.length > 0 && (
                  <div className="selected-chips-container">
                    {selectedMembers.map(user => (
                      <div key={user.id} className="selected-chip">
                        <span className="chip-name">{user.display_name || user.username}</span>
                        <button
                          type="button"
                          className="chip-remove-btn"
                          onClick={() => setSelectedMembers(prev => prev.filter(u => u.id !== user.id))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <SearchField label="Поиск пользователей" className="search-container modal-search"
                    placeholder="Поиск пользователей по имени..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
              />

                {memberLoading ? (
                  <div className="search-status" style={{ padding: '8px 0' }}>
                    <div className="spinner" style={{ width: '16px', height: '16px', borderColor: 'var(--text-secondary)', borderTopColor: 'var(--accent-color)' }} />
                    <span style={{ fontSize: '12px' }}>Поиск...</span>
                  </div>
                ) : memberSearchQuery.trim() !== '' && memberResults.length === 0 ? (
                  <div className="search-status" style={{ padding: '8px 0', fontSize: '12px' }}>
                    <span>Никто не найден</span>
                  </div>
                ) : memberResults.length > 0 ? (
                  <div className="search-results-list mini" style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {memberResults.map(user => {
                      const isSelected = selectedMembers.some(u => u.id === user.id);
                      return (
                        <div
                          key={user.id}
                          role="button"
                          tabIndex={0}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.currentTarget.click();
                            }
                          }}
                          className={`search-user-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedMembers(prev => prev.filter(u => u.id !== user.id));
                            } else {
                              setSelectedMembers(prev => [...prev, user]);
                            }
                            setMemberSearchQuery('');
                            setMemberResults([]);
                          }}
                          style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <div className="chat-avatar" style={{ width: '28px', height: '28px', minWidth: '28px', fontSize: '12px' }}>{renderAvatar(user.avatar, personAvatarFallback(user))}</div>
                          <div className="search-user-info" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                            <span className="search-user-name" style={{ fontSize: '15px', fontWeight: '500' }}>{user.display_name || user.username}</span>
                            <span className="search-user-username" style={{ fontSize: '14px', opacity: 0.7 }}>@{user.username}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            style={{ cursor: 'pointer' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <Button type="submit" className="group-submit-btn" disabled={!groupName.trim() || creating}>
                <Users size={18} />
                <span>{creating ? 'Создание...' : 'Создать группу'}</span>
              </Button>
            </form>
          )}

          {newChatModalTab === 'channel' && (
            <form onSubmit={handleCreateChannelSubmit} className="group-chat-create-form">
              <div className="input-group">
                <label htmlFor="channelName">Название канала *</label>
                <input
                  id="channelName"
                  type="text"
                  placeholder="Например: Новости Coiny 🌊"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Invite Subscribers section */}
              <div className="input-group">
                <label>Пригласить подписчиков</label>
                {selectedMembers.length > 0 && (
                  <div className="selected-chips-container">
                    {selectedMembers.map(user => (
                      <div key={user.id} className="selected-chip">
                        <span className="chip-name">{user.display_name || user.username}</span>
                        <button
                          type="button"
                          className="chip-remove-btn"
                          onClick={() => setSelectedMembers(prev => prev.filter(u => u.id !== user.id))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <SearchField label="Поиск пользователей" className="search-container modal-search"
                    placeholder="Поиск пользователей по имени..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
              />

                {memberLoading ? (
                  <div className="search-status" style={{ padding: '8px 0' }}>
                    <div className="spinner" style={{ width: '16px', height: '16px', borderColor: 'var(--text-secondary)', borderTopColor: 'var(--accent-color)' }} />
                    <span style={{ fontSize: '12px' }}>Поиск...</span>
                  </div>
                ) : memberSearchQuery.trim() !== '' && memberResults.length === 0 ? (
                  <div className="search-status" style={{ padding: '8px 0', fontSize: '12px' }}>
                    <span>Никто не найден</span>
                  </div>
                ) : memberResults.length > 0 ? (
                  <div className="search-results-list mini" style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {memberResults.map(user => {
                      const isSelected = selectedMembers.some(u => u.id === user.id);
                      return (
                        <div
                          key={user.id}
                          role="button"
                          tabIndex={0}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.currentTarget.click();
                            }
                          }}
                          className={`search-user-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedMembers(prev => prev.filter(u => u.id !== user.id));
                            } else {
                              setSelectedMembers(prev => [...prev, user]);
                            }
                            setMemberSearchQuery('');
                            setMemberResults([]);
                          }}
                          style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <div className="chat-avatar" style={{ width: '28px', height: '28px', minWidth: '28px', fontSize: '12px' }}>{renderAvatar(user.avatar, personAvatarFallback(user))}</div>
                          <div className="search-user-info" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                            <span className="search-user-name" style={{ fontSize: '15px', fontWeight: '500' }}>{user.display_name || user.username}</span>
                            <span className="search-user-username" style={{ fontSize: '14px', opacity: 0.7 }}>@{user.username}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            style={{ cursor: 'pointer' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <Button type="submit" className="group-submit-btn" disabled={!channelName.trim() || creating} style={{ background: 'var(--accent-gradient)' }}>
                <Users size={18} />
                <span>{creating ? 'Создание...' : 'Создать канал'}</span>
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
