import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../supabaseClient';
import {
  UserCircle,
  Users,
  Megaphone,
  Bookmark,
  Settings,
  Moon,
  X
} from 'lucide-react';
import { uploadSanitizedPublicImage } from '../services/publicMediaService';
import { personAvatarFallback } from '../context/chat/avatarFallback';
import IconButton from './ui/IconButton';
import Switch from './ui/Switch';
import './MainMenuDrawer.css';

export default function MainMenuDrawer() {
  const {
    isDrawerOpen,
    setIsDrawerOpen,
    openSettings,
    setIsNewChatOpen,
    isDarkMode,
    setIsDarkMode,
    setNewChatModalTab,
    renderAvatar,
    openSavedMessages
  } = useChat();
  const { currentUser, updateProfile } = useAuth();

  const drawerRef = useRef(null);

  // Touch Gestures to swipe close MainMenuDrawer
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchMoveRef = useRef({ x: 0, y: 0 });
  const isSwipeCloseGestureRef = useRef(false);

  const handleDrawerTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    touchStartRef.current = { x: startX, y: startY };
    touchMoveRef.current = { x: startX, y: startY };
    isSwipeCloseGestureRef.current = false;
  };

  const handleDrawerTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartRef.current.x;
    const deltaY = currentY - touchStartRef.current.y;
    touchMoveRef.current = { x: currentX, y: currentY };
    if (!isSwipeCloseGestureRef.current) {
      if (deltaX < -15 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        isSwipeCloseGestureRef.current = true;
      }
    }
    if (isSwipeCloseGestureRef.current) {
      e.preventDefault();
    }
  };

  const handleDrawerTouchEnd = () => {
    if (isSwipeCloseGestureRef.current) {
      const deltaX = touchMoveRef.current.x - touchStartRef.current.x;
      if (deltaX < -50) {
        setIsDrawerOpen(false);
      }
    }
    isSwipeCloseGestureRef.current = false;
  };

  // Close drawer on escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isDrawerOpen) {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, setIsDrawerOpen]);

  const [isUploading, setIsUploading] = useState(false);
  const [isOpeningSaved, setIsOpeningSaved] = useState(false);
  const [savedError, setSavedError] = useState('');
  const savedSessionRef = useRef({ userId: currentUser?.id });
  if (savedSessionRef.current.userId !== currentUser?.id) savedSessionRef.current = { userId: currentUser?.id };
  useEffect(() => { setIsOpeningSaved(false); setSavedError(''); }, [currentUser?.id]);
  const avatarInputRef = useRef(null);

  const handleAvatarUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsUploading(true);
      try {
        if (isSupabaseConfigured) {
          const { reference } = await uploadSanitizedPublicImage(file, 'avatar');
          await updateProfile({ avatar: reference });
        } else {
          const reader = new FileReader();
          reader.onload = async (event) => {
            await updateProfile({ avatar: event.target.result });
          };
          reader.readAsDataURL(file);
        }
      } catch (err) {
        console.error("Avatar upload failed", err);
        alert(`Ошибка при загрузке аватара: ${err.message || err}`);
      } finally {
        setIsUploading(false);
      }
    }
  };

  if (!currentUser) return null;

  const handleOpenSavedMessages = async () => {
    if (isOpeningSaved) return;
    const session = savedSessionRef.current;
    setIsOpeningSaved(true);
    setSavedError('');
    try {
      const saved = await openSavedMessages?.();
      if (savedSessionRef.current !== session) return;
      if (!saved?.id) throw new Error('Saved messages unavailable');
      setIsDrawerOpen(false);
    } catch (e) {
      if (savedSessionRef.current !== session) return;
      console.error("Failed to open/create Saved Messages chat", e);
      setSavedError('Не удалось открыть Избранное. Попробуйте ещё раз.');
    } finally {
      if (savedSessionRef.current === session) setIsOpeningSaved(false);
    }
  };

  const handleItemClick = (action) => {
    setIsDrawerOpen(false);
    if (action) action();
  };

  return (
    <div className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={() => setIsDrawerOpen(false)}>
      <div
        className={`drawer-container ${isDrawerOpen ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        ref={drawerRef}
        onTouchStart={handleDrawerTouchStart}
        onTouchMove={handleDrawerTouchMove}
        onTouchEnd={handleDrawerTouchEnd}
      >
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-header-top">
            <button
              type="button"
              className="drawer-user-avatar"
              onClick={() => avatarInputRef.current?.click()}
              title="Загрузить фото профиля"
              aria-label="Загрузить фото профиля"
              disabled={isUploading}
            >
              {renderAvatar(currentUser.avatar, personAvatarFallback(currentUser))}
              {isUploading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '10px' }}>
                  ...
                </div>
              )}
            </button>
            <IconButton label="Закрыть меню" className="drawer-close-btn" onClick={() => setIsDrawerOpen(false)}>
              <X size={18} />
            </IconButton>
          </div>

          <div className="drawer-user-info-row">
            <div className="drawer-user-meta">
              <span className="drawer-user-name">
                {currentUser.name}
              </span>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>

        {/* Drawer Menu List */}
        <div className="drawer-menu-list">

          {/* My Profile */}
          <button
            className="drawer-menu-item"
            onClick={() => handleItemClick(() => {
              openSettings('profile');
            })}
          >
            <UserCircle size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">Мой профиль</span>
          </button>

          {/* Create Group */}
          <button
            className="drawer-menu-item"
            onClick={() => handleItemClick(() => {
              setNewChatModalTab('group');
              setIsNewChatOpen(true);
            })}
          >
            <Users size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">Создать группу</span>
          </button>

          {/* Create Channel */}
          <button
            className="drawer-menu-item"
            onClick={() => handleItemClick(() => {
              setNewChatModalTab('channel');
              setIsNewChatOpen(true);
            })}
          >
            <Megaphone size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">Создать канал</span>
          </button>

          {/* Saved Messages */}
          <button
            className="drawer-menu-item"
            onClick={handleOpenSavedMessages}
            disabled={isOpeningSaved}
            aria-busy={isOpeningSaved}
            aria-describedby={savedError ? "saved-messages-error" : undefined}
          >
            <Bookmark size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">{isOpeningSaved ? 'Открытие…' : 'Избранное'}</span>
          </button>

          {savedError && <p id="saved-messages-error" className="drawer-saved-error" role="alert">{savedError}</p>}

          {/* Settings */}
          <button
            className="drawer-menu-item"
            onClick={() => handleItemClick(() => {
              openSettings();
            })}
          >
            <Settings size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">Настройки</span>
          </button>

          {/* Night Mode Toggle */}
          <label className="drawer-menu-item no-hover-toggle" htmlFor="drawer-dark-mode">
            <div className="drawer-toggle-left">
              <Moon size={20} className="drawer-item-icon" />
              <span className="drawer-item-text">Ночной режим</span>
            </div>
            <Switch id="drawer-dark-mode" checked={isDarkMode} onChange={setIsDarkMode} />
          </label>

        </div>

        {/* Drawer Footer */}
        <div className="drawer-footer">
          <span className="drawer-app-title">
            {/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.Capacitor
              ? 'Coiny Mobile'
              : 'Coiny Desktop'}
          </span>
          <span className="drawer-version">
            Версия {import.meta.env.APP_VERSION} — О программе
          </span>
        </div>
      </div>
    </div>
  );
}
