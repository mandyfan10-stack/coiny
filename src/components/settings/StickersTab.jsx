import React from 'react';
import { Package, Sparkles, Film, Image as ImageIcon } from 'lucide-react';
import SettingStatus from './SettingStatus';

export default function StickersTab({ stickerPackInput, setStickerPackInput, importLoading, importStatus, handleImportStickers, installedStickers }) {
  return <div className="settings-tab-content">
    <form className="settings-section" onSubmit={event => { event.preventDefault(); handleImportStickers(); }}>
      <h3 className="section-title">Импорт стикеров</h3>
      <div className="input-group">
        <label htmlFor="settings-sticker-pack">Имя набора или ссылка из Telegram</label>
        <input id="settings-sticker-pack" type="text" placeholder="https://t.me/addstickers/set_name" value={stickerPackInput}
          onChange={event => setStickerPackInput(event.target.value)} disabled={importLoading} />
      </div>
      <button type="submit" className="settings-action settings-primary" disabled={importLoading || !stickerPackInput.trim()}>{importLoading ? 'Импорт…' : 'Импортировать'}</button>
      <SettingStatus status={importStatus} />
    </form>
    <div className="settings-section">
      <h3 className="section-title">Установленные наборы ({installedStickers.length})</h3>
      {!installedStickers.length && <p className="settings-help">Пока нет установленных наборов.</p>}
      {installedStickers.map(pack => <div key={pack.id} className="settings-sticker-pack">
        {pack.is_animated ? <Sparkles size={20} /> : pack.is_video ? <Film size={20} /> : <ImageIcon size={20} />}
        <div><span>{pack.title}</span><small>{pack.stickers?.length || 0} стикеров · {pack.is_animated ? 'Анимированный' : pack.is_video ? 'Видео' : 'Статический'}</small></div>
        <Package size={18} aria-hidden="true" />
      </div>)}
    </div>
  </div>;
}
