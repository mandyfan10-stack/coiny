import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { E2EEProvider } from './context/E2EEContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { CallProvider, useCalls } from './context/CallContext';

import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ChatInfo from './components/ChatInfo';
import StoryViewer from './components/StoryViewer';
import AuthScreen from './components/AuthScreen';
import NewChatModal from './components/NewChatModal';
import CreateStoryModal from './components/CreateStoryModal';
import MainMenuDrawer from './components/MainMenuDrawer';
import E2EESetupModal from './components/E2EESetupModal';
import { isMisconfigured } from './supabaseClient';
import { normalizeExternalHttpsUrl } from './utils/urlSecurity';
import { initNotificationService } from './services/notificationService';
import { parseInviteParam, savePendingInvite, clearInviteParamFromUrl } from './utils/inviteLink';
import { useInviteHandler } from './hooks/useInviteHandler';
import { X } from 'lucide-react';
// Shared by SettingsModal, NewChatModal, CreateStoryModal — must load with shell
// so closed overlays never participate in app flex layout.
import './components/SettingsModal.css';

const CURRENT_VERSION = import.meta.env.APP_VERSION;

const SettingsModal = lazy(() => import('./components/SettingsModal'));
const CallOverlay = lazy(() => import('./components/CallOverlay'));
const SETTINGS_EXIT_DURATION_MS = 260;

function DeferredSettingsModal() {
  const { isSettingsOpen } = useChat();
  const [shouldRender, setShouldRender] = useState(isSettingsOpen);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    let unmountTimer;

    if (isSettingsOpen) {
      if (!shouldRender) {
        const activeElement = document.activeElement;
        returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      }
      setShouldRender(true);
    } else if (shouldRender) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      unmountTimer = window.setTimeout(() => {
        setShouldRender(false);

        const originalTarget = returnFocusRef.current;
        const originalStyle = originalTarget?.isConnected
          ? window.getComputedStyle(originalTarget)
          : null;
        const originalIsVisible = Boolean(
          originalTarget?.isConnected
          && originalStyle?.visibility !== 'hidden'
          && originalStyle?.display !== 'none'
          && originalTarget.getClientRects().length
        );
        const fallbackTarget = document.querySelector('.menu-btn[title="Настройки"]');
        const focusTarget = originalIsVisible ? originalTarget : fallbackTarget;

        window.requestAnimationFrame(() => {
          focusTarget?.focus?.({ preventScroll: true });
          returnFocusRef.current = null;
        });
      }, reduceMotion ? 0 : SETTINGS_EXIT_DURATION_MS);
    }

    return () => window.clearTimeout(unmountTimer);
  }, [isSettingsOpen, shouldRender]);

  if (!shouldRender) return null;
  return (
    <Suspense fallback={null}>
      <SettingsModal />
    </Suspense>
  );
}

function DeferredCallOverlay() {
  const { callState } = useCalls();
  if (callState.status === 'idle') return null;
  return (
    <Suspense fallback={null}>
      <CallOverlay />
    </Suspense>
  );
}

function UpdateModal({ show, releaseInfo, onClose }) {
  if (!show || !releaseInfo) return null;

  return (
    <div className="settings-modal-overlay open" style={{ zIndex: 10000 }}>
      <div className="settings-container update-modal-container" style={{ maxWidth: '400px', width: '90%' }}>
        <div className="settings-header">
          <h3>Доступно обновление! 🚀</h3>
          <button className="settings-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📦</div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '600' }}>
              Версия {releaseInfo.tagName}
            </h4>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Текущая версия: {CURRENT_VERSION}
            </span>
          </div>

          {releaseInfo.body && (
            <div className="update-changelog" style={{
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '12px',
              borderRadius: '8px',
              maxHeight: '120px',
              overflowY: 'auto',
              fontSize: '13px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)'
            }}>
              <strong>Что нового:</strong><br />
              {releaseInfo.body}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            <a
              href={normalizeExternalHttpsUrl(releaseInfo.downloadUrl) || undefined}
              target="_blank"
              rel="noreferrer"
              className="add-member-btn"
              style={{
                textAlign: 'center',
                textDecoration: 'none',
                display: 'block',
                padding: '10px'
              }}
            >
              Скачать обновление
            </a>
            <button
              onClick={onClose}
              className="picker-tab-btn"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-color)',
                padding: '10px',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const isNewerVersion = (latest, current) => {
  const parse = (v) => v.split('.').map(Number);
  const latestParts = parse(latest);
  const currentParts = parse(current);

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
};

function MainLayout() {
  const { currentUser, authLoading } = useAuth();
  const {
    activeChatId,
    setActiveChatId,
    chats,
    createChat,
    joinChatByInvite,
    openSavedMessages,
    isDrawerOpen,
    setIsDrawerOpen
  } = useChat();
  const [showUpdate, setShowUpdate] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState(null);

  useInviteHandler({
    currentUser,
    chats,
    createChat,
    joinChatByInvite,
    setActiveChatId,
    openSavedMessages
  });

  const touchStartRef = React.useRef({ x: 0, y: 0 });
  const touchMoveRef = React.useRef({ x: 0, y: 0 });
  const isDrawerGestureRef = React.useRef(false);

  const handleGlobalTouchStart = (e) => {
    if (window.innerWidth >= 768 || e.touches.length !== 1 || isDrawerOpen || activeChatId) return;
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    if (startX > 30) {
      touchStartRef.current = { x: 0, y: 0 };
      return;
    }
    touchStartRef.current = { x: startX, y: startY };
    touchMoveRef.current = { x: startX, y: startY };
    isDrawerGestureRef.current = false;
  };

  const handleGlobalTouchMove = (e) => {
    if (window.innerWidth >= 768 || e.touches.length !== 1 || touchStartRef.current.x === 0) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartRef.current.x;
    const deltaY = currentY - touchStartRef.current.y;
    touchMoveRef.current = { x: currentX, y: currentY };
    if (!isDrawerGestureRef.current) {
      if (deltaX > 15 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        isDrawerGestureRef.current = true;
      } else if (Math.abs(deltaY) > 15 || deltaX < -15) {
        touchStartRef.current = { x: 0, y: 0 };
      }
    }
    if (isDrawerGestureRef.current) {
      e.preventDefault();
    }
  };

  const handleGlobalTouchEnd = () => {
    if (window.innerWidth >= 768 || !isDrawerGestureRef.current || touchStartRef.current.x === 0) {
      isDrawerGestureRef.current = false;
      touchStartRef.current = { x: 0, y: 0 };
      return;
    }
    const deltaX = touchMoveRef.current.x - touchStartRef.current.x;
    if (deltaX > 50) {
      setIsDrawerOpen(true);
    }
    isDrawerGestureRef.current = false;
    touchStartRef.current = { x: 0, y: 0 };
  };

  useEffect(() => {
    const checkUpdates = async () => {
      if (!CURRENT_VERSION) return;
      try {
        const STORAGE_KEY = 'coiny_last_update_check';
        const lastCheck = Number(localStorage.getItem(STORAGE_KEY) || '0');
        const now = Date.now();
        // Check at most once every 6 hours
        if (now - lastCheck < 6 * 60 * 60 * 1000) return;

        const repo = import.meta.env.VITE_GITHUB_REPO || 'mandyfan10-stack/coingram-chat';
        const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
        localStorage.setItem(STORAGE_KEY, String(now));
        if (!response.ok) return;

        const data = await response.json();
        const tagName = data.tag_name;
        if (!tagName) return;
        const cleanTagName = tagName.replace(/^v/, '');

        if (isNewerVersion(cleanTagName, CURRENT_VERSION)) {
          const downloadUrl = data.html_url;
          setReleaseInfo({
            tagName,
            body: data.body,
            downloadUrl
          });
          setShowUpdate(true);
        }
      } catch (err) {
        console.warn('Failed to check for updates:', err);
      }
    };

    checkUpdates();
    initNotificationService();
  }, []);

  if (authLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="spinner-large"></div>
        <p>Инициализация Coiny...</p>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen />;
  }

  return (
    <div
      className={`app-container ${activeChatId ? 'active-chat-selected' : ''}`}
      onTouchStart={handleGlobalTouchStart}
      onTouchMove={handleGlobalTouchMove}
      onTouchEnd={handleGlobalTouchEnd}
    >
      <h1 className="sr-only" style={{ display: 'none' }}>Coiny</h1>
      <Sidebar />
      <ChatArea />
      <ChatInfo />
      <DeferredSettingsModal />
      <StoryViewer />
      <NewChatModal />
      <CreateStoryModal />
      <MainMenuDrawer />
      <DeferredCallOverlay />
      <E2EESetupModal />
      <UpdateModal show={showUpdate} releaseInfo={releaseInfo} onClose={() => setShowUpdate(false)} />
    </div>
  );
}

function MisconfiguredScreen() {
  return (
    <div className="auth-loading-screen" style={{ padding: '24px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>Приложение не настроено</h1>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        В production-сборке отсутствуют переменные{' '}
        <code>VITE_SUPABASE_URL</code> и{' '}
        <code>VITE_SUPABASE_ANON_KEY</code> (или{' '}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>).
        Без них клиент не может подключиться к backend.
      </p>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: '12px 0 0' }}>
        Пересоберите приложение с корректным <code>.env</code>.
        Для редкого демо без Supabase можно задать{' '}
        <code>VITE_ALLOW_MOCK=true</code>.
      </p>
    </div>
  );
}

function App() {
  useEffect(() => {
    const invite = parseInviteParam();
    if (invite) {
      savePendingInvite(invite);
      clearInviteParamFromUrl();
    }
  }, []);

  if (isMisconfigured) {
    return <MisconfiguredScreen />;
  }

  return (
    <AuthProvider>
      <E2EEProvider>
        <ChatProvider>
          <CallProvider>
            <MainLayout />
          </CallProvider>
        </ChatProvider>
      </E2EEProvider>
    </AuthProvider>
  );
}

export default App;
