import React, { useState } from 'react';
import { Check, Image as ImageIcon, Upload, Trash2 } from 'lucide-react';
import { SETTINGS_THEMES as themes } from './themesData';
import { isCustomBubbleGeometryEnabled, setCustomBubbleGeometryEnabled } from '../../utils/bubbleGeometrySupport';
import useResolvedMedia from '../../hooks/useResolvedMedia';
import SettingSwitch from './SettingSwitch';
import SettingStatus from './SettingStatus';

export default function AppearanceTab({
  theme, setTheme, isDarkMode, setIsDarkMode, wallpaper, setWallpaper,
  wallpaperInputRef, handleWallpaperUpload, isUploadingWallpaper,
  themePending, themeError, wallpaperError
}) {
  const [customGeometry, setCustomGeometry] = useState(() => isCustomBubbleGeometryEnabled());
  const effectiveCustomUrl = wallpaper && !['classic', 'default', 'sunset', 'space', 'mint', 'cyber'].includes(wallpaper) ? wallpaper : '';
  const hasCustomWallpaper = Boolean(effectiveCustomUrl);
  const { url: resolvedPreviewUrl } = useResolvedMedia(hasCustomWallpaper ? effectiveCustomUrl : null);
  const isDirectUrl = /^(data:|blob:|https?:\/\/)/.test(effectiveCustomUrl);
  const displayPreview = resolvedPreviewUrl || (isDirectUrl ? effectiveCustomUrl : null);

  return <div className="settings-tab-content">
    <div className="settings-section">
      <SettingSwitch id="settings-dark-mode" title="Тёмный режим" description={isDarkMode ? 'Тёмное оформление интерфейса' : 'Светлое оформление интерфейса'}
        checked={isDarkMode} onChange={setIsDarkMode} />
    </div>
    <div className="settings-section">
      <h3 className="section-title">Цветовая тема</h3>
      <div className="themes-grid" role="group" aria-label="Цветовая тема" aria-busy={Boolean(themePending)}>
        {themes.map(item => <button key={item.id} type="button" className={`theme-selection-btn ${theme === item.id ? 'active' : ''}`}
          onClick={() => setTheme(item.id)} disabled={themePending} aria-pressed={theme === item.id} style={{ '--theme-color': item.color }}>
          <span className="theme-color-dot" aria-hidden="true" /><span className="theme-color-name">{item.name}</span>
          {theme === item.id && <Check size={16} className="theme-check-icon" aria-hidden="true" />}
        </button>)}
      </div>
      <SettingStatus error={themeError} />
    </div>
    <div className="settings-section">
      <h3 className="section-title">Обои чата</h3>
      <input ref={wallpaperInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/*" onChange={handleWallpaperUpload} hidden />
      <div className="settings-wallpaper-preview" data-testid="settings-wallpaper-preview">
        {displayPreview ? <img src={displayPreview} alt="Обои чата" className="wallpaper-preview-img" /> : <ImageIcon size={28} aria-hidden="true" />}
        <span className="settings-wallpaper-bubble">Так выглядит сообщение</span>
      </div>
      <p className="settings-help">{hasCustomWallpaper ? 'Установлено ваше изображение' : 'Стандартный фон выбранной темы'}</p>
      <div className="settings-actions-row">
        <button type="button" className="settings-action" disabled={isUploadingWallpaper} onClick={() => wallpaperInputRef.current?.click()}>
          <Upload size={18} /><span>{isUploadingWallpaper ? 'Загрузка…' : hasCustomWallpaper ? 'Изменить обои' : 'Загрузить обои'}</span>
        </button>
        {hasCustomWallpaper && <button type="button" className="settings-action settings-danger" disabled={isUploadingWallpaper}
          onClick={() => {
            setWallpaper('classic');
            if (wallpaperInputRef?.current) wallpaperInputRef.current.value = '';
          }}><Trash2 size={18} /><span>Удалить обои</span></button>}
      </div>
      <p className="settings-help">PNG, JPG, WebP</p>
      <SettingStatus error={wallpaperError} />
    </div>
    <div className="settings-section">
      <h3 className="section-title">Форма сообщений</h3>
      <SettingSwitch id="settings-bubble-geometry" title="Плавные скругления" description="Параметрические суперэллипсы"
        checked={customGeometry} onChange={value => { setCustomGeometry(value); setCustomBubbleGeometryEnabled(value); }} />
    </div>
  </div>;
}
