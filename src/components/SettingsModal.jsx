import React, { lazy, Suspense, useRef, useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';
import './SettingsModal.css';
import './settings/SettingsDialog.css';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import { X, ArrowLeft, ChevronRight, User, Palette, Bell, Sparkles, ShieldCheck, Database, LogOut } from 'lucide-react';
import ProfileTab from './settings/ProfileTab';
import AppearanceTab from './settings/AppearanceTab';
import NotificationsTab from './settings/NotificationsTab';
import StorageTab from './settings/StorageTab';
import E2EETab from './settings/E2EETab';
import SettingStatus from './settings/SettingStatus';
import { uploadSanitizedPublicImage } from '../services/publicMediaService';
import { personAvatarFallback } from '../context/chat/avatarFallback';
import { buildInviteLink } from '../utils/inviteLink';
import { copyTextToClipboard } from '../utils/mobileActionSheetUtils';
import { normalizeSettingsSection } from '../utils/settingsNavigation';

const StickersTab = lazy(() => import('./settings/StickersTab'));
const SECTIONS = [
  { id: 'profile', title: 'Профиль', icon: User },
  { id: 'appearance', title: 'Оформление', icon: Palette },
  { id: 'notifications', title: 'Уведомления', icon: Bell },
  { id: 'stickers', title: 'Стикеры', icon: Sparkles },
  { id: 'security', title: 'Безопасность', icon: ShieldCheck },
  { id: 'storage', title: 'Память и данные', icon: Database }
];
const emptyStatus = { text: '', type: null };
const errorStatus = (error) => ({ text: error?.message || 'Не удалось сохранить изменение. Попробуйте ещё раз.', type: 'error' });
const readImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
  reader.readAsDataURL(file);
});

export default function SettingsModal() {
  const {
    isSettingsOpen, setIsSettingsOpen, registerSettingsBackHandler,
    theme, setTheme, wallpaper, setWallpaper, isDarkMode, setIsDarkMode,
    settingsTab, setSettingsTab, renderAvatar, installedStickers, importStickerPack
  } = useChat();
  const { currentUser, updateProfile, updateEmail, logOut } = useAuth();
  const { e2eePrivateKey, resetE2EE } = useE2EE();
  const [isVisible, setIsVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height || window.innerHeight);
  const section = normalizeSettingsSection(settingsTab) || (isMobile ? null : 'profile');
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const bodyRef = useRef(null);
  const keepEditingRef = useRef(null);
  const didSetInitialFocusRef = useRef(false);
  const initializedRef = useRef(false);
  const pendingRef = useRef(new Set());
  const [pending, setPending] = useState({});
  const [saveErrors, setSaveErrors] = useState({});
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState('');
  const [baseline, setBaseline] = useState({ name: '', bio: '', email: '' });
  const [profileStatus, setProfileStatus] = useState(emptyStatus);
  const [emailStatus, setEmailStatus] = useState(emptyStatus);
  const [passwordStatus, setPasswordStatus] = useState(emptyStatus);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notif, setNotif] = useState(true);
  const [copied, setCopied] = useState(false);
  const [stickerPackInput, setStickerPackInput] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importStatus, setImportStatus] = useState(emptyStatus);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const wallpaperInputRef = useRef(null);
  const profileDirty = name !== baseline.name || bio !== baseline.bio;
  const emailDirty = email.trim().toLowerCase() !== baseline.email.trim().toLowerCase();
  const hasDirtyForms = profileDirty || emailDirty || Boolean(newPassword || confirmPassword);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    let viewportFrame;
    const resize = () => setIsMobile(media.matches);
    const resizeViewport = () => {
      setViewportHeight(window.visualViewport?.height || window.innerHeight);
      window.cancelAnimationFrame(viewportFrame);
      viewportFrame = window.requestAnimationFrame(() => {
        if (dialogRef.current?.contains(document.activeElement)) {
          document.activeElement?.scrollIntoView({ block: 'nearest' });
        }
      });
    };
    media.addEventListener('change', resize);
    window.visualViewport?.addEventListener('resize', resizeViewport);
    return () => {
      window.cancelAnimationFrame(viewportFrame);
      media.removeEventListener('change', resize);
      window.visualViewport?.removeEventListener('resize', resizeViewport);
    };
  }, []);

  // Initialize drafts once per opening. Background profile updates must not replace them.
  useEffect(() => {
    if (!isSettingsOpen) { initializedRef.current = false; return; }
    if (!currentUser || initializedRef.current) return;
    initializedRef.current = true;
    const saved = { name: currentUser.name || '', bio: currentUser.bio || '', email: currentUser.email || '' };
    setBaseline(saved);
    setName(saved.name);
    setBio(saved.bio);
    setEmail(saved.email);
    setNotif(currentUser.notificationsEnabled !== false);
    setNewPassword('');
    setConfirmPassword('');
    setProfileStatus(emptyStatus);
    setEmailStatus(emptyStatus);
    setPasswordStatus(emptyStatus);
    setSaveErrors({});
    setCopied(false);
    setDiscardPrompt(false);
  }, [currentUser, isSettingsOpen]);

  useEffect(() => {
    let firstFrame;
    let enterFrame;
    if (isSettingsOpen) {
      firstFrame = window.requestAnimationFrame(() => {
        enterFrame = window.requestAnimationFrame(() => setIsVisible(true));
      });
    } else setIsVisible(false);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(enterFrame);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) didSetInitialFocusRef.current = false;
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen || !isVisible || didSetInitialFocusRef.current) return undefined;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const focusTimer = window.setTimeout(() => {
      didSetInitialFocusRef.current = true;
      closeButtonRef.current?.focus({ preventScroll: true });
    }, reduceMotion ? 32 : 260);
    return () => window.clearTimeout(focusTimer);
  }, [isSettingsOpen, isVisible]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    // A removed mobile navigation button must not leave focus behind the dialog.
    if (didSetInitialFocusRef.current) closeButtonRef.current?.focus({ preventScroll: true });
  }, [section]);

  useEffect(() => {
    if (discardPrompt) keepEditingRef.current?.focus({ preventScroll: true });
  }, [discardPrompt]);

  const requestClose = () => {
    if (hasDirtyForms) setDiscardPrompt(true);
    else setIsSettingsOpen(false);
  };
  const handleBack = () => {
    if (discardPrompt) { setDiscardPrompt(false); closeButtonRef.current?.focus(); }
    else if (isMobile && section) setSettingsTab(null);
    else requestClose();
  };

  useEffect(() => {
    if (!isSettingsOpen) return undefined;
    return registerSettingsBackHandler?.(handleBack);
  });

  useEffect(() => {
    if (!isSettingsOpen || !isVisible) return undefined;
    const handleDialogKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        handleBack();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = discardPrompt ? dialogRef.current?.querySelector('[role="alertdialog"]') : dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        return element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none';
      });
      if (!focusable.length) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDialogKeyDown);
  });

  const startRequest = (key) => {
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    setPending(previous => ({ ...previous, [key]: true }));
    return true;
  };
  const finishRequest = (key) => {
    pendingRef.current.delete(key);
    setPending(previous => ({ ...previous, [key]: false }));
  };
  const persistSetting = async (key, value, previousValue, apply) => {
    if (!startRequest(key)) return false;
    setSaveErrors(previous => ({ ...previous, [key]: '' }));
    apply(value);
    try {
      const result = await updateProfile({ [key]: value });
      if (result?.error) throw result.error;
      return true;
    } catch (error) {
      apply(previousValue);
      setSaveErrors(previous => ({ ...previous, [key]: errorStatus(error).text }));
      return false;
    } finally { finishRequest(key); }
  };
  const handleProfileSave = async (event) => {
    event.preventDefault();
    if (!startRequest('profile')) return;
    const fields = { name, bio };
    setProfileStatus(emptyStatus);
    try {
      const result = await updateProfile(fields);
      if (result?.error) throw result.error;
      setBaseline(previous => ({ ...previous, ...fields }));
      setProfileStatus({ text: 'Профиль сохранён.', type: 'success' });
    } catch (error) { setProfileStatus(errorStatus(error)); }
    finally { finishRequest('profile'); }
  };
  const handleEmailSave = async (event) => {
    event.preventDefault();
    if (!startRequest('email')) return;
    const nextEmail = email.trim().toLowerCase();
    setEmailStatus(emptyStatus);
    try {
      const result = await updateEmail(nextEmail);
      if (result?.error) throw result.error;
      setBaseline(previous => ({ ...previous, email: nextEmail }));
      setEmailStatus({ text: 'Письмо для подтверждения нового email отправлено.', type: 'success' });
    } catch (error) { setEmailStatus(errorStatus(error)); }
    finally { finishRequest('email'); }
  };
  const handlePasswordChange = async (event) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) { setPasswordStatus(errorStatus(new Error('Пароли не совпадают.'))); return; }
    if (newPassword.length < 6) { setPasswordStatus(errorStatus(new Error('Пароль должен быть не менее 6 символов.'))); return; }
    if (!startRequest('password')) return;
    setPasswordStatus(emptyStatus);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(''); setConfirmPassword('');
      setPasswordStatus({ text: 'Пароль успешно изменён.', type: 'success' });
    } catch (error) { setPasswordStatus(errorStatus(error)); }
    finally { finishRequest('password'); }
  };
  const handleImageUpload = async (event, field) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file || !startRequest(field)) return;
    setSaveErrors(previous => ({ ...previous, [field]: '' }));
    try {
      const reference = isSupabaseConfigured
        ? (await uploadSanitizedPublicImage(file, field)).reference
        : await readImage(file);
      const result = await updateProfile({ [field]: reference });
      if (result?.error) throw result.error;
      if (field === 'wallpaper') setWallpaper(reference);
    } catch (error) { setSaveErrors(previous => ({ ...previous, [field]: errorStatus(error).text })); }
    finally { finishRequest(field); input.value = ''; }
  };
  const handleBannerRemove = async () => {
    if (!startRequest('banner')) return;
    setSaveErrors(previous => ({ ...previous, banner: '' }));
    try {
      const result = await updateProfile({ banner: null, banner_path: null });
      if (result?.error) throw result.error;
    } catch (error) { setSaveErrors(previous => ({ ...previous, banner: errorStatus(error).text })); }
    finally { finishRequest('banner'); }
  };
  const handleImportStickers = async () => {
    let packName = stickerPackInput.trim();
    if (!packName || importLoading) return;
    if (packName.includes('addstickers/')) packName = packName.split('addstickers/').pop().split('?')[0].split('#')[0];
    else if (packName.includes('t.me/')) packName = packName.split('t.me/').pop().split('?')[0].split('#')[0];
    setImportLoading(true); setImportStatus(emptyStatus);
    try {
      const result = await importStickerPack(packName);
      if (result.error) throw new Error(result.error);
      setImportStatus({ text: `Пак «${result.title}» импортирован.`, type: 'success' });
      setStickerPackInput('');
    } catch (error) { setImportStatus(errorStatus(error)); }
    finally { setImportLoading(false); }
  };
  const handleCopyInviteLink = async () => {
    try {
      await copyTextToClipboard(buildInviteLink(currentUser?.username));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) { setProfileStatus(errorStatus(error)); }
  };
  const handleLogoutClick = async () => {
    if (window.confirm('Вы уверены, что хотите выйти из аккаунта?')) {
      setIsSettingsOpen(false);
      await logOut();
    }
  };

  if (!currentUser) return null;
  const profileLink = (
    <button type="button" className="settings-sidebar-profile" onClick={() => setSettingsTab('profile')}>
      <span className="settings-sidebar-avatar">{renderAvatar(currentUser.avatar, personAvatarFallback(currentUser))}</span>
      <span className="settings-sidebar-userinfo">
        <span className="settings-sidebar-name">{currentUser.name || 'Пользователь'}</span>
        <span className="settings-sidebar-username">@{currentUser.username}</span>
      </span>
      {isMobile && <ChevronRight size={18} aria-hidden="true" />}
    </button>
  );
  const navigation = (
    <nav className="settings-nav-list" aria-label="Разделы настроек">
      {SECTIONS.map(({ id, title, icon: Icon }) => (
        <button key={id} type="button" className={`settings-nav-item ${section === id ? 'active' : ''}`}
          data-section={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSettingsTab(id)}>
          <Icon size={20} aria-hidden="true" /><span className="nav-item-label">{title}</span>
          {isMobile && <ChevronRight size={18} aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
  const logout = (
    <button type="button" className="settings-nav-item logout-item" onClick={handleLogoutClick}>
      <LogOut size={20} aria-hidden="true" /><span>Выйти из аккаунта</span>
    </button>
  );
  return (
    <div className={`settings-modal-overlay settings-dialog-overlay ${isVisible ? 'open' : ''}`}
      style={{ '--settings-viewport-height': `${viewportHeight}px` }} aria-hidden={!isVisible}>
      <div ref={dialogRef} className="settings-container settings-dialog" role="dialog" aria-modal="true"
        aria-labelledby="settings-dialog-title" tabIndex={-1}>
        {!isMobile && <aside className="settings-sidebar" inert={discardPrompt || undefined}>
          {profileLink}{navigation}<div className="settings-sidebar-footer">{logout}</div>
        </aside>}
        <main className="settings-main" inert={discardPrompt || undefined}>
          <header className="settings-header">
            {isMobile && section && <button type="button" className="settings-back-btn" aria-label="Назад к настройкам" onClick={handleBack}><ArrowLeft size={22} /></button>}
            <h2 id="settings-dialog-title">{SECTIONS.find(item => item.id === section)?.title || 'Настройки'}</h2>
            <button ref={closeButtonRef} type="button" className="settings-close-btn" aria-label="Закрыть настройки" onClick={requestClose}><X size={22} /></button>
          </header>
          <div className="settings-body" ref={bodyRef}>
            {!section && <div className="settings-mobile-home">{profileLink}{navigation}<div className="settings-home-logout">{logout}</div></div>}
            {section === 'profile' && <>
              <ProfileTab currentUser={currentUser} renderAvatar={renderAvatar} name={name} setName={setName} bio={bio} setBio={setBio}
                copied={copied} handleCopyInviteLink={handleCopyInviteLink} avatarInputRef={avatarInputRef}
                handleAvatarUpload={event => handleImageUpload(event, 'avatar')} isUploadingAvatar={pending.avatar}
                bannerInputRef={bannerInputRef} handleBannerUpload={event => handleImageUpload(event, 'banner')}
                handleBannerRemove={handleBannerRemove} isUploadingBanner={pending.banner}
                handleProfileSave={handleProfileSave} profileSaving={pending.profile} profileDirty={profileDirty} profileStatus={profileStatus} />
              <SettingStatus error={saveErrors.avatar || saveErrors.banner} />
            </>}
            {section === 'appearance' && <AppearanceTab theme={theme} setTheme={value => persistSetting('theme', value, theme, setTheme)}
              isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} wallpaper={wallpaper}
              setWallpaper={value => persistSetting('wallpaper', value, wallpaper, setWallpaper)}
              wallpaperInputRef={wallpaperInputRef} handleWallpaperUpload={event => handleImageUpload(event, 'wallpaper')}
              isUploadingWallpaper={pending.wallpaper} themePending={pending.theme} themeError={saveErrors.theme} wallpaperError={saveErrors.wallpaper} />}
            {section === 'notifications' && <NotificationsTab notif={notif}
              setNotif={value => persistSetting('notificationsEnabled', value, notif, setNotif)}
              pending={pending.notificationsEnabled} error={saveErrors.notificationsEnabled} />}
            {section === 'stickers' && <Suspense fallback={<p className="settings-help">Загрузка стикеров…</p>}>
              <StickersTab installedStickers={installedStickers} stickerPackInput={stickerPackInput} setStickerPackInput={setStickerPackInput}
                handleImportStickers={handleImportStickers} importLoading={importLoading} importStatus={importStatus} />
            </Suspense>}
            {section === 'security' && <E2EETab currentUser={currentUser} e2eePrivateKey={e2eePrivateKey}
              setIsSettingsOpen={setIsSettingsOpen} resetE2EE={resetE2EE} email={email} setEmail={setEmail}
              emailStatus={emailStatus} emailLoading={pending.email} emailEditable={isSupabaseConfigured} emailDirty={emailDirty} handleEmailSave={handleEmailSave}
              newPassword={newPassword} setNewPassword={setNewPassword} confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              passwordStatus={passwordStatus} passwordLoading={pending.password} handlePasswordChange={handlePasswordChange} />}
            {section === 'storage' && <StorageTab />}
          </div>
        </main>
        {discardPrompt && <div className="settings-discard-overlay">
          <div role="alertdialog" aria-modal="true" aria-labelledby="settings-discard-title" aria-describedby="settings-discard-description" className="settings-discard-dialog">
            <h3 id="settings-discard-title">Закрыть без сохранения?</h3>
            <p id="settings-discard-description">Изменения в формах будут потеряны. Сохранённые настройки останутся.</p>
            <button ref={keepEditingRef} type="button" className="settings-action" onClick={() => { setDiscardPrompt(false); closeButtonRef.current?.focus(); }}>Продолжить редактирование</button>
            <button type="button" className="settings-action settings-danger" onClick={() => setIsSettingsOpen(false)}>Закрыть без сохранения</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
