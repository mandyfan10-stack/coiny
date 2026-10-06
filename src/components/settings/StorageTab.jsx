import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getCacheStorageStats, clearMediaAndMessageCache } from '../../utils/indexedDbHelper';
import SettingStatus from './SettingStatus';

export default function StorageTab() {
  const [stats, setStats] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getCacheStorageStats().then(value => { if (!cancelled) setStats(value); })
      .catch(error => { if (!cancelled) setStatus({ text: error.message || 'Не удалось прочитать кэш.', type: 'error' }); });
    return () => { cancelled = true; };
  }, []);
  const clear = async () => {
    setClearing(true); setStatus(null);
    try {
      await clearMediaAndMessageCache();
      setStats(await getCacheStorageStats());
      setStatus({ text: 'Кэш очищен.', type: 'success' });
    } catch (error) { setStatus({ text: error.message || 'Не удалось очистить кэш.', type: 'error' }); }
    finally { setClearing(false); }
  };
  return <div className="settings-section">
    <h3 className="section-title">Кэш на устройстве</h3>
    <p className="settings-help">Сохранённые сообщения и медиа ускоряют открытие чатов.</p>
    <dl className="settings-data-list">
      <div><dt>Размер медиа</dt><dd>{stats ? `${(stats.mediaBytes / (1024 * 1024)).toFixed(1)} МБ` : '…'}</dd></div>
      <div><dt>Сообщения</dt><dd>{stats?.messageCount ?? '…'}</dd></div>
      <div><dt>Медиафайлы</dt><dd>{stats?.mediaCount ?? '…'}</dd></div>
    </dl>
    <button type="button" className="settings-action settings-danger cache-clear-btn" onClick={clear}
      disabled={!stats || clearing || (!stats.messageCount && !stats.mediaCount)}>
      <Trash2 size={18} /><span>{clearing ? 'Очистка…' : 'Очистить кэш'}</span>
    </button>
    <SettingStatus status={status} />
  </div>;
}
