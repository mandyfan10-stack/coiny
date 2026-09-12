import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { formatLastSeen } from '../utils/formatLastSeen';
import { useCalls } from '../context/CallContext';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Phone,
  Search,
  Bell,
  BellOff,
  Link,
  FileText,
  ExternalLink,
  Check,
  Copy,
  Trash2,
  LogOut,
  Camera,
  Lock,
  UserPlus,
  Shield,
  Crown,
  MoreVertical,
  Image as ImageIcon,
  Play
} from 'lucide-react';
import useResolvedMedia from '../hooks/useResolvedMedia';
import { isSavedMessagesChat } from '../utils/savedMessages';
import { chatAvatarFallback, personAvatarFallback } from '../context/chat/avatarFallback';
import { normalizeExternalHttpsUrl } from '../utils/urlSecurity';
import ImageViewer from './chat/ImageViewer';
import { DecryptedVoicePlayer } from './chat/mediaPlayers';
import { buildInviteLink } from '../utils/inviteLink';
import { copyTextToClipboard } from '../utils/mobileActionSheetUtils';

import './ChatInfo.css';

const computeSafetyNumber = async (keyA, keyB) => {
  if (!keyA || !keyB) return '';
  const sorted = [keyA, keyB].sort();
  const joined = sorted.join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(joined);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const view = new DataView(hashBuffer);

  const segment1 = String(view.getUint32(0) % 100000).padStart(5, '0');
  const segment2 = String(view.getUint32(4) % 100000).padStart(5, '0');
  const segment3 = String(view.getUint32(8) % 100000).padStart(5, '0');
  const segment4 = String(view.getUint32(12) % 100000).padStart(5, '0');
  const segment5 = String(view.getUint32(16) % 100000).padStart(5, '0');

  return `${segment1} ${segment2} ${segment3} ${segment4} ${segment5}`;
};

function MediaGridItem({ item, index, chatId, onOpenPreview }) {
  const sourceUrl = typeof item === 'object' && item?.url ? item.url : item;
  const isVideo = typeof item === 'object' ? Boolean(item.isVideo) : /\.(mp4|webm|mov|ogv)/i.test(sourceUrl);
  const fallbackMime = isVideo ? 'video/mp4' : 'image/png';
  const { url, loading, error } = useResolvedMedia(sourceUrl, chatId, fallbackMime);

  if (loading) {
    return (
      <div className="info-media-thumb-btn media-grid-status" aria-label="Загрузка вложения">
        <div className="spinner media-grid-spinner" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className="info-media-thumb-btn media-grid-status media-grid-error">
        {isVideo ? 'Видео' : 'Медиа'}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="info-media-thumb-btn"
      onClick={() => onOpenPreview(url, isVideo)}
      title={`Вложение ${index + 1}`}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {isVideo ? (
        <>
          <video
            src={url}
            className="info-media-thumb-img"
            muted
            playsInline
            preload="metadata"
            style={{ objectFit: 'cover' }}
          />
          <div
            className="info-media-video-badge"
            style={{
              position: 'absolute',
              bottom: 4,
              right: 4,
              background: 'rgba(0, 0, 0, 0.7)',
              borderRadius: '4px',
              padding: '2px 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              pointerEvents: 'none'
            }}
          >
            <Play size={10} fill="currentColor" />
          </div>
        </>
      ) : (
        <img src={url} alt={`Вложение ${index + 1}`} className="info-media-thumb-img" />
      )}
    </button>
  );
}

export default function ChatInfo() {
  const {
    activeChat,
    getChatStatus,
    onlineUsers,
    isInfoOpen,
    setIsInfoOpen,
    renderAvatar,
    deleteChat,
    clearChatMessages,
    updateChatAvatar,
    updateChatSettings,
    addMemberToChat,
    toggleMemberRole,
    loadOlderMessages,
    openUserProfile
  } = useChat();

  const { startCall } = useCalls();
  const { currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState('media');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSafety, setCopiedSafety] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isAddingMemberOpen, setIsAddingMemberOpen] = useState(false);
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState('');
  const [safetyNumber, setSafetyNumber] = useState('');
  const [activeActionMemberId, setActiveActionMemberId] = useState(null);
  const [openedPreview, setOpenedPreview] = useState(null);

  const fileInputRef = useRef(null);
  const scrollableRef = useRef(null);

  // Scroll to top when info sidebar opens or chat changes
  useEffect(() => {
    if (isInfoOpen && scrollableRef.current) {
      scrollableRef.current.scrollTop = 0;
    }
  }, [isInfoOpen, activeChat?.id]);

  // When ChatInfo is open, progressively load older messages in the background to discover all media
  useEffect(() => {
    if (!isInfoOpen || !activeChat?.id || !loadOlderMessages) return;
    let isCancelled = false;

    const fetchAllHistory = async () => {
      let loaded = 1;
      for (let i = 0; i < 5 && loaded > 0 && !isCancelled; i++) {
        loaded = await loadOlderMessages(activeChat.id);
        if (loaded === 0) break;
      }
    };

    fetchAllHistory().catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, [isInfoOpen, activeChat?.id, loadOlderMessages]);

  // Compute E2EE Safety Number for personal chats
  useEffect(() => {
    if (activeChat?.type === 'personal') {
      const otherMember = activeChat.members?.find((m) => m.id !== currentUser?.id);
      const keyA = currentUser?.public_key;
      const keyB = otherMember?.publicKey;
      if (keyA && keyB) {
        computeSafetyNumber(keyA, keyB).then(setSafetyNumber).catch(console.error);
      }
    }
  }, [activeChat, currentUser]);

  const isOwner =
    activeChat &&
    currentUser &&
    (activeChat.createdBy === currentUser.id ||
      activeChat.createdBy === 'current' ||
      (!activeChat.createdBy && activeChat.type === 'group'));

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result;
        await updateChatAvatar(activeChat.id, base64data);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyShareLink = async () => {
    const inviteLink = buildInviteLink(activeChat.username || activeChat.id);
    await copyTextToClipboard(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyUsername = async () => {
    if (!activeChat?.username) return;
    await copyTextToClipboard(`@${activeChat.username}`);
    setCopiedUsername(true);
    setTimeout(() => setCopiedUsername(false), 2000);
  };

  const handleCopySafety = async () => {
    if (!safetyNumber) return;
    await copyTextToClipboard(safetyNumber);
    setCopiedSafety(true);
    setTimeout(() => setCopiedSafety(false), 2000);
  };

  const handleAddMemberSubmit = async (e) => {
    e.preventDefault();
    if (!newMemberUsername.trim()) return;

    setAddingMember(true);
    setAddMemberError('');

    const targetUsername = newMemberUsername.startsWith('@')
      ? newMemberUsername.substring(1)
      : newMemberUsername;

    const res = await addMemberToChat(activeChat.id, targetUsername);
    setAddingMember(false);

    if (res.error) {
      setAddMemberError(res.error);
    } else {
      setNewMemberUsername('');
      setIsAddingMemberOpen(false);
    }
  };

  // Extract files, media, and links dynamically from messages
  const { mediaFiles, docFiles, linksList } = useMemo(() => {
    const mFiles = [];
    const dFiles = [];
    const lList = [];
    if (activeChat && activeChat.messages) {
      activeChat.messages.forEach((m) => {
        if (m.media) {
          const isVoice = Boolean(
            m.text?.startsWith('🎤') ||
            m.text?.includes('Голосовое сообщение') ||
            (typeof m.media === 'string' && (m.media.includes('audio_') || m.media.startsWith('data:audio/')))
          );
          const isVideoNote = Boolean(
            m.text?.startsWith('🎬 Видеосообщение') ||
            m.text?.includes('Видеосообщение')
          );
          const isVideo =
            !isVoice &&
            (/\.(mp4|mov|ogv|mkv)/i.test(m.media) ||
              (m.media.includes('.webm') && !m.media.includes('audio_')) ||
              m.media.startsWith('data:video') ||
              m.text?.startsWith('🎬') ||
              m.text?.includes('Видео'));
          const isImage =
            !isVoice &&
            !isVideo &&
            (/\.(jpeg|jpg|gif|png|webp|svg)/i.test(m.media) ||
              m.media.startsWith('data:image') ||
              m.text?.includes('Изображение'));

          if (isImage || isVideo || isVideoNote) {
            mFiles.push({
              url: m.media,
              isVideo: Boolean(isVideo || isVideoNote),
              timestamp: m.timestamp
            });
          } else if (isVoice) {
            const match = m.text?.match(/\((\d+):(\d+)\)/);
            const voiceDuration = match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : 0;
            dFiles.push({
              name: m.text || 'Голосовое сообщение',
              media: m.media,
              isVoice: true,
              duration: voiceDuration,
              size: 'Голосовое',
              date: new Date(m.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short' })
            });
          } else {
            const filename = m.media.split('/').pop().split('_').slice(1).join('_') || m.text || 'Вложенный файл';
            dFiles.push({
              name: filename,
              media: m.media,
              size: 'Вложение',
              date: new Date(m.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short' })
            });
          }
        }

        if (m.text) {
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          const matches = m.text.match(urlRegex);
          if (matches) {
            matches.forEach((url) => {
              try {
                const safeUrl = normalizeExternalHttpsUrl(url);
                if (!safeUrl) return;
                const parsed = new URL(safeUrl);
                lList.push({
                  title: safeUrl,
                  url: safeUrl,
                  host: parsed.hostname
                });
              } catch {
                /* ignore */
              }
            });
          }
        }
      });
    }
    return { mediaFiles: mFiles, docFiles: dFiles, linksList: lList };
  }, [activeChat]);

  // Preseeded mock data fallback only for demo chats to keep initial UI engaging
  const isPreseededMock = activeChat && ['chat-1', 'chat-2', 'chat-6'].includes(activeChat.id);
  if (isPreseededMock && mediaFiles.length === 0 && docFiles.length === 0 && linksList.length === 0) {
    mediaFiles.push(
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=300&q=80',
      'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=300&q=80'
    );
    docFiles.push(
      { name: 'Архитектурный_план.pdf', size: '2.4 MB', date: 'Вчера, 12:44' },
      { name: 'Техническая_спецификация.docx', size: '840 KB', date: '28 июня, 17:02' },
      { name: 'Бюджет_проекта_2026.xlsx', size: '1.2 MB', date: '15 июня, 11:15' }
    );
    linksList.push(
      { title: 'Официальный сайт React', url: 'https://react.dev', host: 'react.dev' },
      { title: 'Документация Vite 6', url: 'https://vite.dev', host: 'vite.dev' },
      { title: 'DeepMind Advanced Coding', url: 'https://deepmind.google', host: 'deepmind.google' }
    );
  }

  // Filter members by search
  const filteredMembers = useMemo(() => {
    if (!activeChat?.members) return [];
    if (!memberSearchQuery.trim()) return activeChat.members;
    const clean = memberSearchQuery.trim().toLowerCase();
    return activeChat.members.filter(
      (m) =>
        m.name?.toLowerCase().includes(clean) ||
        m.username?.toLowerCase().includes(clean)
    );
  }, [activeChat?.members, memberSearchQuery]);

  const isPersonal = activeChat?.type === 'personal';
  const isSavedMessages = isSavedMessagesChat(activeChat);
  const otherMember = isPersonal ? (activeChat?.members || []).find((m) => m.id !== currentUser?.id) : null;
  const contactBanner = isSavedMessages ? currentUser?.banner : (otherMember?.banner || activeChat?.banner);
  const { url: bannerUrl } = useResolvedMedia(contactBanner);

  if (!activeChat) return null;

  const isGroupOrChannel = activeChat.type === 'group' || activeChat.type === 'channel';
  const statusText = getChatStatus(activeChat);
  const isOnlineStatus = statusText.toLowerCase().includes('в сети');

  return (
    <aside className={`chat-info ${isInfoOpen ? 'open' : ''}`}>
      <div className="chat-info-inner">
        {/* Top Header */}
        <div className="info-header">
          <h3 className="info-header-title">Информация</h3>
          <div className="info-header-actions">
            <button
              type="button"
              className="info-icon-btn"
              onClick={() => setIsInfoOpen(false)}
              title="Закрыть"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="chat-info-scrollable" ref={scrollableRef}>
          {/* Main Profile Hero */}
          <div className={`info-hero-section ${bannerUrl ? 'has-banner' : ''}`}>
            {bannerUrl && (
              <div className="info-hero-banner">
                <img src={bannerUrl} alt="Баннер" className="info-hero-banner-img" />
                <div className="info-hero-banner-overlay" />
              </div>
            )}
            <div
              className={`info-avatar-wrapper ${isOwner && isGroupOrChannel ? 'editable' : ''}`}
              onClick={() => isOwner && isGroupOrChannel && fileInputRef.current?.click()}
              title={isOwner && isGroupOrChannel ? 'Сменить фото чата' : activeChat.name}
            >
              <div className="info-avatar-hero">{renderAvatar(activeChat.avatar, chatAvatarFallback(activeChat))}</div>
              {isOwner && isGroupOrChannel && (
                <div className="avatar-edit-badge" title="Сменить фото">
                  <Camera size={14} />
                </div>
              )}
              {isOwner && isGroupOrChannel && (
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleAvatarChange}
                />
              )}
            </div>

            <h2 className="info-name-hero">{activeChat.name}</h2>
            <span className={`info-status-hero ${isOnlineStatus ? 'online' : ''}`}>
              {statusText}
            </span>

            {/* Quick Actions Strip */}
            {!isSavedMessages && (
              <div className="info-quick-actions-bar">
                {/* 1. Call */}
                <button
                  type="button"
                  className="quick-action-item"
                  title="Звонок"
                  data-testid="start-call"
                  onClick={() => startCall(activeChat.id)}
                >
                  <div className="quick-action-icon-circle">
                    <Phone size={18} />
                  </div>
                  <span className="quick-action-label">Звонок</span>
                </button>

                {/* 2. Notifications Toggle */}
                <button
                  type="button"
                  className="quick-action-item"
                  title={isMuted ? 'Включить уведомления' : 'Выключить звук'}
                  onClick={() => setIsMuted((prev) => !prev)}
                >
                  <div className="quick-action-icon-circle">
                    {isMuted ? <BellOff size={18} /> : <Bell size={18} />}
                  </div>
                  <span className="quick-action-label">
                    {isMuted ? 'Без звука' : 'Звук'}
                  </span>
                </button>

                {/* 3. Copy Invite / Profile Link */}
                <button
                  type="button"
                  className="quick-action-item"
                  title="Скопировать ссылку"
                  onClick={handleCopyShareLink}
                >
                  <div className="quick-action-icon-circle">
                    {copiedLink ? <Check size={18} style={{ color: '#4fae4e' }} /> : <Link size={18} />}
                  </div>
                  <span className="quick-action-label">
                    {copiedLink ? 'Скопировано' : 'Ссылка'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Metadata Cards */}
          <div className="info-card-section">
            {/* Bio / Description */}
            {activeChat.bio && (
              <div className="info-item-row">
                <div className="info-item-content">
                  <span className="info-item-value">{activeChat.bio}</span>
                  <span className="info-item-label">Описание</span>
                </div>
              </div>
            )}

            {/* Username */}
            {activeChat.username && (
              <div className="info-item-row">
                <div className="info-item-content">
                  <span className="info-item-value">@{activeChat.username}</span>
                  <span className="info-item-label">Имя пользователя</span>
                </div>
                <button
                  type="button"
                  className={`info-copy-pill-btn ${copiedUsername ? 'copied' : ''}`}
                  onClick={handleCopyUsername}
                  title="Скопировать @username"
                >
                  {copiedUsername ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}

            {/* E2EE Safety Number for Personal Chat */}
            {isPersonal && safetyNumber && (
              <div className="info-safety-box">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Lock size={14} style={{ color: 'var(--accent-color)' }} />
                    <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-color)' }}>
                      Код безопасности (Safety Number)
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`info-copy-pill-btn ${copiedSafety ? 'copied' : ''}`}
                    onClick={handleCopySafety}
                    title="Скопировать код"
                  >
                    {copiedSafety ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="info-safety-code">{safetyNumber}</div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                  Сравните код с собеседником для подтверждения сквозного шифрования.
                </span>
              </div>
            )}
          </div>

          {/* Members Section for Group / Channel */}
          {isGroupOrChannel && (
            <div className="info-members-section">
              <div className="info-section-header-bar">
                <h4 className="info-section-heading">
                  {activeChat.members?.length || 0}{' '}
                  {activeChat.type === 'channel' ? 'подписчиков' : 'участников'}
                </h4>
                {(isOwner || activeChat.settings?.allow_add_members !== false) && (
                  <button
                    type="button"
                    className="info-add-member-trigger"
                    onClick={() => setIsAddingMemberOpen((prev) => !prev)}
                  >
                    <UserPlus size={14} />
                    <span>Добавить</span>
                  </button>
                )}
              </div>

              {/* Add member inline form */}
              {isAddingMemberOpen && (
                <div className="info-add-member-collapse">
                  <form onSubmit={handleAddMemberSubmit} className="info-add-member-box">
                    <input
                      type="text"
                      placeholder="Введите @username..."
                      value={newMemberUsername}
                      onChange={(e) => setNewMemberUsername(e.target.value)}
                      className="info-add-member-input"
                      autoFocus
                    />
                    <button type="submit" className="info-add-submit-btn" disabled={addingMember}>
                      {addingMember ? '...' : 'ОК'}
                    </button>
                  </form>
                  {addMemberError && (
                    <span style={{ fontSize: '11px', color: '#ff5959', marginTop: '4px', display: 'block' }}>
                      {addMemberError}
                    </span>
                  )}
                </div>
              )}

              {/* Filter search if members > 4 */}
              {activeChat.members && activeChat.members.length > 4 && (
                <div className="info-member-search-box">
                  <Search size={12} className="info-member-search-icon" />
                  <input
                    type="text"
                    placeholder="Поиск участников..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    className="info-member-search-input"
                  />
                </div>
              )}

              {/* Members List */}
              <div className="info-members-list">
                {filteredMembers.map((member) => {
                  const isMemberOwner =
                    member.id === activeChat.createdBy ||
                    (member.id === 'current' && activeChat.createdBy === currentUser?.id) ||
                    (member.id === currentUser?.id && activeChat.createdBy === 'current');

                  const isMe = member.id === 'current' || member.id === currentUser?.id;
                  const isOnline = isMe || onlineUsers.has(member.id);

                  let roleBadge = null;
                  if (isMemberOwner) {
                    roleBadge = (
                      <span className="info-role-badge owner">
                        <Crown size={10} style={{ marginRight: '2px', display: 'inline' }} />
                        {isMe ? 'Владелец (Вы)' : 'Владелец'}
                      </span>
                    );
                  } else if (member.role === 'admin') {
                    roleBadge = (
                      <span className="info-role-badge admin">
                        <Shield size={10} style={{ marginRight: '2px', display: 'inline' }} />
                        {isMe ? 'Админ (Вы)' : 'Админ'}
                      </span>
                    );
                  }

                  const showMenu = activeActionMemberId === member.id;

                  return (
                    <div
                      key={member.id}
                      className="info-member-row"
                      onClick={() => {
                        if (!isMe && member.id !== 'current') {
                          if (openUserProfile) {
                            openUserProfile(member);
                          }
                        }
                      }}
                      style={{ cursor: !isMe ? 'pointer' : 'default' }}
                      title={!isMe ? `Открыть профиль ${member.name}` : ''}
                    >
                      <div className="info-member-avatar-wrap">
                        <div className="info-member-avatar">{renderAvatar(member.avatar, personAvatarFallback(member))}</div>
                        {isOnline && <div className="member-online-dot" />}
                      </div>

                      <div className="info-member-info">
                        <span className="info-member-name">{member.name}</span>
                        <div className="info-member-status-sub">
                          {roleBadge}
                          <span className={isOnline ? 'online' : ''}>
                            {isOnline ? 'в сети' : formatLastSeen(member.lastSeen, false)}
                          </span>
                        </div>
                      </div>

                      {/* Admin management menu button */}
                      {isOwner && !isMe && (
                        <button
                          type="button"
                          className="info-member-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveActionMemberId((prev) => (prev === member.id ? null : member.id));
                          }}
                          title="Действия"
                        >
                          <MoreVertical size={16} />
                        </button>
                      )}

                      {showMenu && (
                        <div
                          className="info-member-dropdown"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="info-member-dropdown-item"
                            onClick={async () => {
                              setActiveActionMemberId(null);
                              await toggleMemberRole(activeChat.id, member.id, member.role);
                            }}
                          >
                            <Shield size={14} />
                            <span>{member.role === 'admin' ? 'Снять права' : 'Сделать админом'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shared Media Segmented Tabs */}
          <div className="info-segmented-tabs">
            <button
              type="button"
              className={`info-segment-tab ${activeTab === 'media' ? 'active' : ''}`}
              onClick={() => setActiveTab('media')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ImageIcon size={13} />
                <span>Медиа</span>
              </span>
              {mediaFiles.length > 0 && (
                <span className="info-segment-count">{mediaFiles.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`info-segment-tab ${activeTab === 'docs' ? 'active' : ''}`}
              onClick={() => setActiveTab('docs')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <FileText size={13} />
                <span>Файлы</span>
              </span>
              {docFiles.length > 0 && (
                <span className="info-segment-count">{docFiles.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`info-segment-tab ${activeTab === 'links' ? 'active' : ''}`}
              onClick={() => setActiveTab('links')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Link size={13} />
                <span>Ссылки</span>
              </span>
              {linksList.length > 0 && (
                <span className="info-segment-count">{linksList.length}</span>
              )}
            </button>
            {isOwner && isGroupOrChannel && (
              <button
                type="button"
                className={`info-segment-tab ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                <span>Настройки</span>
              </button>
            )}
          </div>

          {/* Tab Pane Contents */}
          <div className="info-tab-pane">
            {/* 1. Media Grid */}
            {activeTab === 'media' && (
              <div className="info-media-grid">
                {mediaFiles.length > 0 ? (
                  mediaFiles.map((item, idx) => {
                    const itemKey = (typeof item === 'object' ? item.url : item) + idx;
                    return (
                      <MediaGridItem
                        key={itemKey}
                        item={item}
                        index={idx}
                        chatId={activeChat.id}
                        onOpenPreview={(fullUrl, isVid) => setOpenedPreview({ url: fullUrl, isVideo: isVid })}
                      />
                    );
                  })
                ) : (
                  <div className="picker-empty-placeholder" style={{ gridColumn: 'span 3', padding: '20px 0' }}>
                    <p style={{ fontSize: '13px' }}>Нет медиа</p>
                    <span style={{ fontSize: '11px' }}>Фото и видео появятся здесь</span>
                  </div>
                )}
              </div>
            )}

            {/* 2. Documents List */}
            {activeTab === 'docs' && (
              <div className="info-docs-list">
                {docFiles.length > 0 ? (
                  docFiles.map((doc, idx) => (
                    <div key={idx} className={`info-doc-item ${doc.isVoice ? 'is-voice-item' : ''}`}>
                      {doc.isVoice ? (
                        <div className="info-doc-voice-box" style={{ width: '100%' }}>
                          <DecryptedVoicePlayer
                            mediaUrl={doc.media}
                            chatId={activeChat.id}
                            duration={doc.duration}
                          />
                          <span className="info-doc-subtext" style={{ display: 'block', marginTop: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {doc.date}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="info-doc-icon-box">
                            <FileText size={18} />
                          </div>
                          <div className="info-doc-info-text">
                            <span className="info-doc-title">{doc.name}</span>
                            <span className="info-doc-subtext">
                              {doc.size} • {doc.date}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="picker-empty-placeholder" style={{ padding: '20px 0' }}>
                    <p style={{ fontSize: '13px' }}>Нет файлов</p>
                    <span style={{ fontSize: '11px' }}>Отправленные файлы будут здесь</span>
                  </div>
                )}
              </div>
            )}

            {/* 3. Links List */}
            {activeTab === 'links' && (
              <div className="info-links-list">
                {linksList.length > 0 ? (
                  linksList.map((link, idx) => (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      key={idx}
                      className="info-link-item"
                    >
                      <div className="info-doc-icon-box">
                        <ExternalLink size={16} />
                      </div>
                      <div className="info-doc-info-text">
                        <span className="info-doc-title">{link.title}</span>
                        <span className="info-doc-subtext">{link.host}</span>
                      </div>
                    </a>
                  ))
                ) : (
                  <div className="picker-empty-placeholder" style={{ padding: '20px 0' }}>
                    <p style={{ fontSize: '13px' }}>Нет ссылок</p>
                    <span style={{ fontSize: '11px' }}>Ссылки из сообщений появятся здесь</span>
                  </div>
                )}
              </div>
            )}

            {/* 4. Chat Settings */}
            {activeTab === 'settings' && isOwner && isGroupOrChannel && (
              <div className="chat-settings-card">
                {activeChat.type === 'group' && (
                  <label className="settings-row-item">
                    <span>Только администраторы могут писать</span>
                    <div className="switch-wrapper">
                      <input
                        type="checkbox"
                        checked={Boolean(activeChat.settings?.only_admins_can_post)}
                        onChange={(e) => {
                          const newSettings = {
                            ...activeChat.settings,
                            only_admins_can_post: e.target.checked
                          };
                          updateChatSettings(activeChat.id, newSettings);
                        }}
                      />
                      <span className="switch-slider" />
                    </div>
                  </label>
                )}

                <label className="settings-row-item">
                  <span>Разрешить отправку медиа</span>
                  <div className="switch-wrapper">
                    <input
                      type="checkbox"
                      checked={activeChat.settings?.allow_media !== false}
                      onChange={(e) => {
                        const newSettings = {
                          ...activeChat.settings,
                          allow_media: e.target.checked
                        };
                        updateChatSettings(activeChat.id, newSettings);
                      }}
                    />
                    <span className="switch-slider" />
                  </div>
                </label>

                <label className="settings-row-item">
                  <span>Разрешить отправку стикеров и GIF</span>
                  <div className="switch-wrapper">
                    <input
                      type="checkbox"
                      checked={activeChat.settings?.allow_stickers_and_gifs !== false}
                      onChange={(e) => {
                        const newSettings = {
                          ...activeChat.settings,
                          allow_stickers_and_gifs: e.target.checked
                        };
                        updateChatSettings(activeChat.id, newSettings);
                      }}
                    />
                    <span className="switch-slider" />
                  </div>
                </label>

                <label className="settings-row-item">
                  <span>Разрешить голосовые и видеосообщения</span>
                  <div className="switch-wrapper">
                    <input
                      type="checkbox"
                      checked={activeChat.settings?.allow_voice_and_video_notes !== false}
                      onChange={(e) => {
                        const newSettings = {
                          ...activeChat.settings,
                          allow_voice_and_video_notes: e.target.checked
                        };
                        updateChatSettings(activeChat.id, newSettings);
                      }}
                    />
                    <span className="switch-slider" />
                  </div>
                </label>

                <label className="settings-row-item">
                  <span>Разрешить добавление участников</span>
                  <div className="switch-wrapper">
                    <input
                      type="checkbox"
                      checked={activeChat.settings?.allow_add_members !== false}
                      onChange={(e) => {
                        const newSettings = {
                          ...activeChat.settings,
                          allow_add_members: e.target.checked
                        };
                        updateChatSettings(activeChat.id, newSettings);
                      }}
                    />
                    <span className="switch-slider" />
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Bottom Danger Action */}
          {(() => {
            const isCreator = activeChat.createdBy === currentUser?.id;

            let buttonIcon = null;
            let buttonLabel = '';
            let confirmPrompt = '';

            if (isSavedMessages) {
              buttonLabel = 'Очистить историю';
              buttonIcon = <Trash2 size={16} />;
              confirmPrompt =
                'Вы уверены, что хотите полностью очистить историю в Избранном?';
            } else if (isPersonal) {
              buttonLabel = 'Удалить чат';
              buttonIcon = <Trash2 size={16} />;
              confirmPrompt =
                'Вы уверены, что хотите полностью удалить этот чат и всю историю?';
            } else if (isCreator) {
              buttonLabel =
                activeChat.type === 'channel' ? 'Удалить канал' : 'Удалить группу';
              buttonIcon = <Trash2 size={16} />;
              confirmPrompt =
                activeChat.type === 'channel'
                  ? 'Удалить канал для всех участников?'
                  : 'Удалить группу для всех участников?';
            } else {
              buttonLabel =
                activeChat.type === 'channel' ? 'Покинуть канал' : 'Выйти из группы';
              buttonIcon = <LogOut size={16} />;
              confirmPrompt =
                activeChat.type === 'channel'
                  ? 'Вы уверены, что хотите покинуть канал?'
                  : 'Вы уверены, что хотите выйти из группы?';
            }

            return (
              <div className="info-danger-zone">
                <button
                  type="button"
                  className="info-danger-btn"
                  onClick={async () => {
                    if (window.confirm(confirmPrompt)) {
                      let success = false;
                      if (isSavedMessages) {
                        success = await clearChatMessages(activeChat.id);
                      } else {
                        success = await deleteChat(activeChat.id);
                      }
                      if (success) {
                        setIsInfoOpen(false);
                      }
                    }
                  }}
                >
                  {buttonIcon}
                  <span>{buttonLabel}</span>
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Fullscreen Media Preview */}
      {openedPreview && (
        <ImageViewer
          imageUrl={openedPreview.url}
          isVideo={openedPreview.isVideo}
          onClose={() => setOpenedPreview(null)}
        />
      )}
    </aside>
  );
}
