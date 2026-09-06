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
import { SETTINGS_THEMES as themes, SETTINGS_WALLPAPERS as wallpapers } from './themesData';
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
        <div className="wallpapers-grid">
          {wallpapers.map((w) => {
            const isActive = wallpaper === w.id && customWallpaperUrl.trim() === '';
            return (
              <button
                key={w.id}
                className={`wallpaper-selection-btn ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setWallpaper(w.id);
                  setCustomWallpaperUrl('');
                }}
                style={{ background: w.style }}
                type="button"
              >
                <span className="wallpaper-label">{w.name}</span>
                {isActive && (
                  <div className="wallpaper-check-badge">
                    <Check size={12} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom Wallpaper File Upload */}
        <div className="input-group" style={{ marginTop: '14px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Или загрузите свой файл обоев
          </label>

          <input
            ref={wallpaperInputRef}
            type="file"
            accept="image/*"
            onChange={handleWallpaperUpload}
            style={{ display: 'none' }}
          />

          <div className="wallpaper-upload-actions" style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button
              type="button"
              className="btn-primary auth-submit-btn"
              onClick={() => wallpaperInputRef.current?.click()}
              style={{ width: 'auto', padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}
              disabled={isUploadingWallpaper}
            >
              <Upload size={14} />
              <span>{isUploadingWallpaper ? 'Загрузка...' : 'Выбрать файл'}</span>
            </button>

            {customWallpaperUrl && (
              <button
                type="button"
                className="logout-btn"
                onClick={() => {
                  setWallpaper('classic');
                  setCustomWallpaperUrl('');
                }}
                style={{ width: 'auto', padding: '8px 16px', fontSize: '13px', margin: 0 }}
              >
                Сбросить
              </button>
            )}
          </div>

          {customWallpaperUrl && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Выбран кастомный фон чата
            </div>
          )}
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
