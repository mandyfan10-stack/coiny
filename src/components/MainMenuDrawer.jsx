import React, { useRef, useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
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

export default function MainMenuDrawer() {
  const {
    isDrawerOpen,
    setIsDrawerOpen,
    setIsSettingsOpen,
    setIsNewChatOpen,
    isDarkMode,
    setIsDarkMode,
    setSettingsTab,
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
    setIsOpeningSaved(true);

    try {
      if (openSavedMessages) {
        await openSavedMessages();
      } else if (isSupabaseConfigured) {
        const { error: savedErr } = await supabase
          .rpc('ensure_saved_messages_chat');
        if (savedErr) throw savedErr;
      }
      setIsDrawerOpen(false);
    } catch (e) {
      console.error("Failed to open/create Saved Messages chat", e);
      alert("Не удалось открыть Избранное");
    } finally {
      setIsOpeningSaved(false);
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
            <div
              className="drawer-user-avatar"
              style={{ cursor: 'pointer', position: 'relative' }}
              onClick={() => avatarInputRef.current?.click()}
              title="Загрузить фото профиля"
            >
              {renderAvatar(currentUser.avatar, personAvatarFallback(currentUser))}
              {isUploading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '10px' }}>
                  ...
                </div>
              )}
            </div>
            <button className="drawer-close-btn" onClick={() => setIsDrawerOpen(false)}>
              <X size={18} />
            </button>
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
              setSettingsTab('profile');
              setIsSettingsOpen(true);
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
          >
            <Bookmark size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">Избранное</span>
          </button>

          {/* Settings */}
          <button 
            className="drawer-menu-item"
            onClick={() => handleItemClick(() => {
              setSettingsTab('settings');
              setIsSettingsOpen(true);
            })}
          >
            <Settings size={20} className="drawer-item-icon" />
            <span className="drawer-item-text">Настройки</span>
          </button>

          {/* Night Mode Toggle */}
          <div className="drawer-menu-item no-hover-toggle">
            <div className="drawer-toggle-left">
              <Moon size={20} className="drawer-item-icon" />
              <span className="drawer-item-text">Ночной режим</span>
            </div>
            <label className="switch-wrapper">
              <input 
                type="checkbox" 
                checked={isDarkMode} 
                onChange={(e) => setIsDarkMode(e.target.checked)}
              />
              <span className="switch-slider"></span>
            </label>
          </div>

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
