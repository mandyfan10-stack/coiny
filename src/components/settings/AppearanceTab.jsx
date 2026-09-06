import React, { useState, useEffect } from 'react';
import {
  Check,
  Bell,
  Palette,
  Image as ImageIcon,
  Upload,
  Smartphone,
  Database,
  Trash2,
  Moon,
  Sun
} from 'lucide-react';
import { requestNotificationPermission } from '../../services/notificationService';
import { SETTINGS_THEMES as themes } from './themesData';
import {
  isHapticsEnabled,
  setHapticsEnabled,
  triggerHaptic,
  HAPTIC_SUCCESS
} from '../../hooks/useMessageTouch';
import {
  getCacheStorageStats,
  clearMediaAndMessageCache
} from '../../utils/indexedDbHelper';
import useResolvedMedia from '../../hooks/useResolvedMedia';

export default function AppearanceTab({
  theme,
  setTheme,
  isDarkMode,
  setIsDarkMode,
  wallpaper,
  setWallpaper,
  customWallpaperUrl,
  setCustomWallpaperUrl,
  notif,
  setNotif,
  wallpaperInputRef,
  handleWallpaperUpload,
  isUploadingWallpaper
}) {
  const [cacheStats, setCacheStats] = useState({ messageCount: 0, chatCount: 0, mediaCount: 0, mediaBytes: 0 });
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearedSuccess, setCacheClearedSuccess] = useState(false);

  useEffect(() => {
    getCacheStorageStats().then(setCacheStats).catch(() => {});
  }, []);

  const effectiveCustomUrl = (customWallpaperUrl && customWallpaperUrl.trim() && !['classic', 'default', 'sunset', 'space', 'mint', 'cyber'].includes(customWallpaperUrl.trim()) ? customWallpaperUrl.trim() : '') ||
    (wallpaper && !['classic', 'default', 'sunset', 'space', 'mint', 'cyber'].includes(wallpaper) ? wallpaper : '');
  const hasCustomWallpaper = Boolean(effectiveCustomUrl);
  const { url: resolvedPreviewUrl } = useResolvedMedia(hasCustomWallpaper ? effectiveCustomUrl : null);
  const isDirectUrl = Boolean(effectiveCustomUrl && (
    effectiveCustomUrl.startsWith('data:') ||
    effectiveCustomUrl.startsWith('blob:') ||
    effectiveCustomUrl.startsWith('http://') ||
    effectiveCustomUrl.startsWith('https://')
  ));
  const displayPreview = resolvedPreviewUrl || (isDirectUrl ? effectiveCustomUrl : null);

  return (
    <div className="settings-appearance-tab" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Theme Mode Customizer (Night / Light Mode) */}
      {typeof isDarkMode === 'boolean' && typeof setIsDarkMode === 'function' && (
        <div className="settings-section">
          <h5 className="section-title">
            {isDarkMode ? <Moon size={16} /> : <Sun size={16} />}
            <span>Режим оформления</span>
          </h5>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px 10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                {isDarkMode ? 'Ночной режим' : 'Обычный (светлый) режим'}
              </span>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                {isDarkMode ? 'Тёмное оформление интерфейса' : 'Светлое оформление интерфейса'}
              </span>
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
      )}
      {/* Theme Customizer */}
      <div className="settings-section">
        <h5 className="section-title">
          <Palette size={16} />
          <span>Цветовая тема</span>
        </h5>
        <div className="themes-grid">
          {themes.map((t) => (
            <button
              key={t.id}
              className={`theme-selection-btn ${theme === t.id ? 'active' : ''}`}
              onClick={() => setTheme(t.id)}
              style={{ '--theme-color': t.color }}
              type="button"
            >
              <span className="theme-color-dot" />
              <span className="theme-color-name">{t.name}</span>
              {theme === t.id && <Check size={14} className="theme-check-icon" />}
            </button>
          ))}
        </div>
      </div>

      {/* Wallpapers Customizer */}
      <div className="settings-section">
        <h5 className="section-title">
          <ImageIcon size={16} />
          <span>Обои чата</span>
        </h5>

        <input
          ref={wallpaperInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/*"
          onChange={handleWallpaperUpload}
          style={{ display: 'none' }}
        />

        {hasCustomWallpaper ? (
          <div className="wallpaper-custom-card">
            <div className="wallpaper-preview-box">
              {displayPreview ? (
                <img
                  src={displayPreview}
                  alt="Обои чата"
                  className="wallpaper-preview-img"
                />
              ) : (
                <div className="wallpaper-preview-placeholder">
                  <ImageIcon size={24} />
                </div>
              )}
            </div>
            <div className="wallpaper-card-details">
              <div className="wallpaper-card-status">
                <span className="wallpaper-card-title">Пользовательские обои</span>
                <span className="wallpaper-card-subtitle">Установлено ваше изображение</span>
              </div>
              <div className="wallpaper-card-actions">
                <button
                  type="button"
                  className="btn-primary auth-submit-btn wallpaper-btn-change"
                  onClick={() => wallpaperInputRef.current?.click()}
                  disabled={isUploadingWallpaper}
                >
                  <Upload size={14} />
                  <span>{isUploadingWallpaper ? 'Загрузка...' : 'Изменить обои'}</span>
                </button>
                <button
                  type="button"
                  className="logout-btn wallpaper-btn-delete"
                  onClick={() => {
                    setWallpaper('classic');
                    setCustomWallpaperUrl('');
                    if (wallpaperInputRef?.current) {
                      wallpaperInputRef.current.value = '';
                    }
                  }}
                  disabled={isUploadingWallpaper}
                >
                  <Trash2 size={14} />
                  <span>Удалить обои</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="wallpaper-default-card">
            <div className="wallpaper-card-details">
              <div className="wallpaper-card-status">
                <span className="wallpaper-card-title">Стандартный фон темы</span>
                <span className="wallpaper-card-subtitle">Используется фоновый градиент выбранной темы</span>
              </div>
              <div className="wallpaper-card-actions">
                <button
                  type="button"
                  className="btn-primary auth-submit-btn wallpaper-btn-upload"
                  onClick={() => wallpaperInputRef.current?.click()}
                  disabled={isUploadingWallpaper}
                >
                  <Upload size={14} />
                  <span>{isUploadingWallpaper ? 'Загрузка...' : 'Загрузить свои обои'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="wallpaper-format-hint">
          Поддерживаемые форматы: PNG, JPG, WebP
        </div>
      </div>

      {/* Notifications Toggle */}
      <div className="settings-section">
        <h5 className="section-title">
          <Bell size={16} />
          <span>Уведомления</span>
        </h5>
        <div className="notif-toggle-row">
          <label htmlFor="notif-toggle">Звуковые и push-уведомления</label>
          <input
            type="checkbox"
            id="notif-toggle"
            checked={notif}
            onChange={async (e) => {
              const nextVal = e.target.checked;
              setNotif(nextVal);
              if (nextVal) {
                await requestNotificationPermission();
              }
            }}
          />
        </div>
      </div>

      {/* Haptics & Tactility Toggle */}
      <div className="settings-section">
        <h5 className="section-title">
          <Smartphone size={16} />
          <span>Тактильный отклик</span>
        </h5>
        <div className="notif-toggle-row">
          <label htmlFor="haptics-toggle">Вибрация и тактильная отдача на нажатия</label>
          <input
            type="checkbox"
            id="haptics-toggle"
            checked={isHapticsEnabled()}
            onChange={(e) => {
              const nextVal = e.target.checked;
              setHapticsEnabled(nextVal);
              if (nextVal) {
                triggerHaptic(HAPTIC_SUCCESS);
              }
            }}
          />
        </div>
      </div>

      {/* Storage & Data / Cache Management */}
      <div className="settings-section">
        <h5 className="section-title">
          <Database size={16} />
          <span>Память и данные</span>
        </h5>
        <div className="cache-stats-card">
          <div className="cache-stats-grid">
            <div className="cache-stat-item">
              <span className="cache-stat-value">{cacheStats.messageCount}</span>
              <span className="cache-stat-label">Сообщений в кэше</span>
            </div>
            <div className="cache-stat-item">
              <span className="cache-stat-value">
                {(cacheStats.mediaBytes / (1024 * 1024)).toFixed(1)} МБ
              </span>
              <span className="cache-stat-label">{cacheStats.mediaCount} медиафайлов</span>
            </div>
          </div>
          <button
            type="button"
            className="cache-clear-btn"
            disabled={isClearingCache || (cacheStats.messageCount === 0 && cacheStats.mediaCount === 0)}
            onClick={async () => {
              setIsClearingCache(true);
              triggerHaptic(HAPTIC_SUCCESS);
              try {
                await clearMediaAndMessageCache();
                const stats = await getCacheStorageStats();
                setCacheStats(stats);
                setCacheClearedSuccess(true);
                setTimeout(() => setCacheClearedSuccess(false), 3000);
              } catch (e) {
                console.error(e);
              } finally {
                setIsClearingCache(false);
              }
            }}
          >
            <Trash2 size={15} />
            <span>{isClearingCache ? 'Очистка...' : cacheClearedSuccess ? 'Кэш очищен' : 'Очистить кэш'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
