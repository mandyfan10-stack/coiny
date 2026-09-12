import React, { lazy, Suspense, useRef, useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';
import './SettingsModal.css';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import { X, User, Palette, Sparkles, ShieldCheck, LogOut } from 'lucide-react';
import ProfileTab from './settings/ProfileTab';
import AppearanceTab from './settings/AppearanceTab';
import E2EETab from './settings/E2EETab';
import { uploadSanitizedPublicImage } from '../services/publicMediaService';
import { personAvatarFallback } from '../context/chat/avatarFallback';
import { buildInviteLink } from '../utils/inviteLink';
import { copyTextToClipboard } from '../utils/mobileActionSheetUtils';

const StickersTab = lazy(() => import('./settings/StickersTab'));

const TAB_TITLES = {
  profile: 'Профиль',
  settings: 'Настройки',
  stickers: 'Стикеры',
  e2ee: 'Шифрование'
};

export default function SettingsModal() {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    theme,
    setTheme,
    wallpaper,
    setWallpaper,
    isDarkMode,
    setIsDarkMode,
    settingsTab,
    setSettingsTab,
    renderAvatar,
    installedStickers,
    importStickerPack
  } = useChat();

  const { currentUser, updateProfile, updateEmail, logOut } = useAuth();
  const { e2eePrivateKey, resetE2EE } = useE2EE();
  const [isVisible, setIsVisible] = useState(false);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const didSetInitialFocusRef = useRef(false);

  useEffect(() => {
    let firstFrame;
    let enterFrame;

    if (isSettingsOpen) {
      firstFrame = window.requestAnimationFrame(() => {
        enterFrame = window.requestAnimationFrame(() => setIsVisible(true));
      });
    } else {
      setIsVisible(false);
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(enterFrame);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) didSetInitialFocusRef.current = false;
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen || !isVisible) return undefined;
    if (didSetInitialFocusRef.current) return undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const focusDialog = () => {
      didSetInitialFocusRef.current = true;
      closeButtonRef.current?.focus({ preventScroll: true });
    };
    const focusTimer = window.setTimeout(focusDialog, reduceMotion ? 32 : 260);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isSettingsOpen, isVisible]);

  useEffect(() => {
    if (!isSettingsOpen || !isVisible) return undefined;

    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsSettingsOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none';
      });

      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDialogKeyDown);
  }, [isSettingsOpen, isVisible, setIsSettingsOpen]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState({ text: '', type: null });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [bio, setBio] = useState('');
  const [notif, setNotif] = useState(true);
  const [copied, setCopied] = useState(false);

  const [stickerPackInput, setStickerPackInput] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importStatus, setImportStatus] = useState({ text: '', type: null });

  const handleImportStickers = async () => {
    let packName = stickerPackInput.trim();
    if (!packName) return;

    if (packName.includes('addstickers/')) {
      packName = packName.split('addstickers/').pop().split('?')[0].split('#')[0];
    } else if (packName.includes('t.me/')) {
      packName = packName.split('t.me/').pop().split('?')[0].split('#')[0];
    }

    setImportLoading(true);
    setImportStatus({ text: '', type: null });
    try {
      const res = await importStickerPack(packName);
      if (res.error) {
        setImportStatus({ text: res.error, type: 'error' });
      } else {
        setImportStatus({ text: `Пак "${res.title}" успешно импортирован!`, type: 'success' });
        setStickerPackInput('');
      }
    } catch (e) {
      setImportStatus({ text: `Ошибка импорта: ${e.message}`, type: 'error' });
    } finally {
      setImportLoading(false);
    }
  };

  const [customWallpaperUrl, setCustomWallpaperUrl] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUploadingWallpaper, setIsUploadingWallpaper] = useState(false);
  const wallpaperInputRef = React.useRef(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarInputRef = React.useRef(null);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const bannerInputRef = React.useRef(null);

  const handleAvatarUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsUploadingAvatar(true);
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
        console.error('Avatar upload failed', err);
        alert(`Ошибка при загрузке аватара: ${err.message || err}`);
      } finally {
        setIsUploadingAvatar(false);
        if (e.target) e.target.value = '';
      }
    }
  };

  const handleBannerUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsUploadingBanner(true);
      try {
        if (isSupabaseConfigured) {
          const { reference } = await uploadSanitizedPublicImage(file, 'banner');
          await updateProfile({ banner: reference });
        } else {
          const reader = new FileReader();
          reader.onload = async (event) => {
            await updateProfile({ banner: event.target.result });
          };
          reader.readAsDataURL(file);
        }
      } catch (err) {
        console.error('Banner upload failed', err);
        alert(`Ошибка при загрузке баннера: ${err.message || err}`);
      } finally {
        setIsUploadingBanner(false);
        if (e.target) e.target.value = '';
      }
    }
  };

  const handleBannerRemove = async () => {
    try {
      setIsUploadingBanner(true);
      await updateProfile({ banner: null, banner_path: null });
    } catch (err) {
      console.error('Banner remove failed', err);
      alert(`Ошибка при удалении баннера: ${err.message || err}`);
    } finally {
      setIsUploadingBanner(false);
    }
  };

  const handleWallpaperUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsUploadingWallpaper(true);
      try {
        if (isSupabaseConfigured) {
          const { reference } = await uploadSanitizedPublicImage(file, 'wallpaper');
          setWallpaper(reference);
          setCustomWallpaperUrl(reference);
        } else {
          const reader = new FileReader();
          reader.onload = (ev) => {
            setWallpaper(ev.target.result);
            setCustomWallpaperUrl(ev.target.result);
          };
          reader.readAsDataURL(file);
        }
      } catch (err) {
        console.error('Wallpaper upload failed', err);
        alert(`Ошибка при загрузке: ${err.message || err}`);
      } finally {
        setIsUploadingWallpaper(false);
        if (e.target) e.target.value = '';
      }
    }
  };

  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState({ text: '', type: null });
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    if (currentUser && isSettingsOpen) {
      setName(currentUser.name || '');
      setEmail(currentUser.email || '');
      setEmailStatus({ text: '', type: null });
      setBio(currentUser.bio || '');
      setNotif(currentUser.notificationsEnabled !== false);
      setCopied(false);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStatus({ text: '', type: null });
    }
  }, [currentUser, isSettingsOpen]);

  useEffect(() => {
    if (currentUser && isSettingsOpen) {
      const deprecatedPresets = ['cyber', 'sunset', 'space', 'mint', 'default'];
      const activeWp = wallpaper || currentUser.wallpaper;
      if (activeWp && deprecatedPresets.includes(activeWp)) {
        setWallpaper('classic');
        setCustomWallpaperUrl('');
      } else if (activeWp && activeWp !== 'classic' && activeWp !== 'default') {
        setCustomWallpaperUrl(activeWp);
      } else {
        setCustomWallpaperUrl('');
      }
    }
  }, [currentUser, isSettingsOpen, wallpaper, setWallpaper]);

  if (!currentUser) return null;

  const handleSave = async () => {
    setSettingsSaving(true);
    setEmailStatus({ text: '', type: null });
    try {
      const currentEmail = String(currentUser.email || '').trim().toLowerCase();
      const nextEmail = String(email || '').trim().toLowerCase();

      if (nextEmail !== currentEmail) {
        const result = await updateEmail(nextEmail);
        if (result.error) {
          setEmailStatus({ text: result.error.message, type: 'error' });
          return;
        }
        setEmailStatus({ text: 'Письмо для подтверждения нового email отправлено.', type: 'success' });
      }

      await updateProfile({
        name,
        bio,
        notificationsEnabled: notif,
        theme,
        wallpaper
      });
      setIsSettingsOpen(false);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleCopyInviteLink = async () => {
    const inviteLink = buildInviteLink(currentUser?.username);
    await copyTextToClipboard(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogoutClick = async () => {
    if (window.confirm('Вы уверены, что хотите выйти из аккаунта?')) {
      setIsSettingsOpen(false);
      await logOut();
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ text: 'Пароли не совпадают!', type: 'error' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordStatus({ text: 'Пароль должен быть не менее 6 символов!', type: 'error' });
      return;
    }

    setPasswordLoading(true);
    setPasswordStatus({ text: '', type: null });
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordStatus({ text: 'Пароль успешно изменен!', type: 'success' });
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordStatus({ text: `Ошибка: ${err.message}`, type: 'error' });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div
      className={`settings-modal-overlay ${isVisible ? 'open' : ''}`}
      aria-hidden={!isVisible}
    >
      <div
        ref={dialogRef}
        className="settings-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
      >
        {/* Left Navigation Sidebar */}
        <aside className="settings-sidebar">
          <div
            className="settings-sidebar-profile"
            onClick={() => setSettingsTab('profile')}
            role="button"
            tabIndex={0}
            title="Перейти в профиль"
          >
            <div className="settings-sidebar-avatar">{renderAvatar(currentUser.avatar, personAvatarFallback(currentUser))}</div>
            <div className="settings-sidebar-userinfo">
              <span className="settings-sidebar-name">{currentUser.name || 'Пользователь'}</span>
              <span className="settings-sidebar-username">@{currentUser.username}</span>
            </div>
          </div>

          <nav className="settings-nav-list">
            <button
              type="button"
              className={`settings-nav-item ${settingsTab === 'profile' ? 'active' : ''}`}
              onClick={() => setSettingsTab('profile')}
            >
              <span className="nav-item-icon"><User size={17} /></span>
              <span className="nav-item-label">Мой профиль</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item ${settingsTab === 'settings' ? 'active' : ''}`}
              onClick={() => setSettingsTab('settings')}
            >
              <span className="nav-item-icon"><Palette size={17} /></span>
              <span className="nav-item-label">Оформление</span>
            </button>
            <button
              type="button"
              className={`settings-nav-item ${settingsTab === 'stickers' ? 'active' : ''}`}
              onClick={() => setSettingsTab('stickers')}
            >
              <span className="nav-item-icon"><Sparkles size={17} /></span>
              <span className="nav-item-label">Стикеры</span>
              {installedStickers?.length > 0 && (
                <span className="nav-item-badge">{installedStickers.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`settings-nav-item ${settingsTab === 'e2ee' ? 'active' : ''}`}
              onClick={() => setSettingsTab('e2ee')}
            >
              <span className="nav-item-icon"><ShieldCheck size={17} /></span>
              <span className="nav-item-label">Шифрование</span>
            </button>
          </nav>

          <div className="settings-sidebar-footer">
            <button type="button" className="settings-nav-item logout-item" onClick={handleLogoutClick}>
              <span className="nav-item-icon"><LogOut size={17} /></span>
              <span className="nav-item-label">Выйти из аккаунта</span>
            </button>
          </div>
        </aside>

        {/* Right Main Content Column */}
        <main className="settings-main">
          <div className="settings-header">
            <h3 id="settings-dialog-title">{TAB_TITLES[settingsTab] || 'Настройки'}</h3>
            <button
              ref={closeButtonRef}
              className="settings-close-btn"
              onClick={() => setIsSettingsOpen(false)}
              aria-label="Закрыть настройки"
            >
              <X size={20} />
            </button>
          </div>

          <div className="settings-body">
            {settingsTab === 'profile' && (
              <ProfileTab
                currentUser={currentUser}
                renderAvatar={renderAvatar}
                name={name}
                setName={setName}
                bio={bio}
                setBio={setBio}
                copied={copied}
                handleCopyInviteLink={handleCopyInviteLink}
                avatarInputRef={avatarInputRef}
                handleAvatarUpload={handleAvatarUpload}
                isUploadingAvatar={isUploadingAvatar}
                bannerInputRef={bannerInputRef}
                handleBannerUpload={handleBannerUpload}
                handleBannerRemove={handleBannerRemove}
                isUploadingBanner={isUploadingBanner}
              />
            )}

            {settingsTab === 'settings' && (
              <AppearanceTab
                theme={theme}
                setTheme={setTheme}
                isDarkMode={isDarkMode}
                setIsDarkMode={setIsDarkMode}
                wallpaper={wallpaper}
                setWallpaper={setWallpaper}
                customWallpaperUrl={customWallpaperUrl}
                setCustomWallpaperUrl={setCustomWallpaperUrl}
                notif={notif}
                setNotif={setNotif}
                wallpaperInputRef={wallpaperInputRef}
                handleWallpaperUpload={handleWallpaperUpload}
                isUploadingWallpaper={isUploadingWallpaper}
              />
            )}

            {settingsTab === 'stickers' && (
              <Suspense fallback={null}>
                <StickersTab
                  stickerPackInput={stickerPackInput}
                  setStickerPackInput={setStickerPackInput}
                  importLoading={importLoading}
                  importStatus={importStatus}
                  handleImportStickers={handleImportStickers}
                  installedStickers={installedStickers}
                />
              </Suspense>
            )}

            {settingsTab === 'e2ee' && (
              <E2EETab
                currentUser={currentUser}
                e2eePrivateKey={e2eePrivateKey}
                setIsSettingsOpen={setIsSettingsOpen}
                resetE2EE={resetE2EE}
                email={email}
                setEmail={setEmail}
                emailStatus={emailStatus}
                emailLoading={settingsSaving}
                emailEditable={isSupabaseConfigured}
                newPassword={newPassword}
                setNewPassword={setNewPassword}
                confirmPassword={confirmPassword}
                setConfirmPassword={setConfirmPassword}
                passwordStatus={passwordStatus}
                passwordLoading={passwordLoading}
                handlePasswordChange={handlePasswordChange}
              />
            )}
          </div>

          <div className="settings-footer">
            <button className="settings-btn cancel" onClick={() => setIsSettingsOpen(false)}>
              Отмена
            </button>
            <button className="settings-btn save" onClick={handleSave} disabled={settingsSaving}>
              {settingsSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
