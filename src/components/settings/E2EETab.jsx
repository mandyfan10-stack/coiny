import React, { useState } from 'react';
import { Copy, Trash2, ShieldCheck } from 'lucide-react';
import { isSupabaseConfigured } from '../../supabaseClient';
import { copyTextToClipboard } from '../../utils/mobileActionSheetUtils';
import SettingStatus from './SettingStatus';

export default function E2EETab({
  currentUser, e2eePrivateKey, setIsSettingsOpen, resetE2EE,
  email, setEmail, emailStatus, emailLoading, emailEditable, emailDirty, handleEmailSave,
  newPassword, setNewPassword, confirmPassword, setConfirmPassword,
  passwordStatus, passwordLoading, handlePasswordChange
}) {
  const [keyStatus, setKeyStatus] = useState(null);
  const copyKey = async () => {
    try {
      await copyTextToClipboard(currentUser.public_key);
      setKeyStatus({ text: 'Публичный ключ скопирован.', type: 'success' });
    } catch (error) { setKeyStatus({ text: error.message || 'Не удалось скопировать ключ.', type: 'error' }); }
  };
  return <div className="settings-tab-content settings-e2ee-tab">
    {isSupabaseConfigured && <>
      <form className="settings-section" onSubmit={handleEmailSave}>
        <h3 className="section-title">Email аккаунта</h3>
        <div className="input-group">
          <label htmlFor="settings-email-input">Email</label>
          <input id="settings-email-input" type="email" autoComplete="email" value={email || ''} required
            onChange={event => setEmail(event.target.value)} disabled={!emailEditable || emailLoading} />
          <span className="input-help-text">Подтвердите новый адрес по ссылке из письма.</span>
        </div>
        <button type="submit" className="settings-action settings-primary" disabled={!emailEditable || emailLoading || !emailDirty}>
          {emailLoading ? 'Сохранение…' : 'Изменить email'}
        </button>
        <SettingStatus status={emailStatus} />
      </form>
      <form className="settings-section password-change-form" onSubmit={handlePasswordChange}>
        <h3 className="section-title">Пароль</h3>
        <div className="input-group">
          <label htmlFor="new-password">Новый пароль</label>
          <input id="new-password" type="password" autoComplete="new-password" placeholder="Минимум 6 символов" required minLength={6}
            value={newPassword || ''} onChange={event => setNewPassword(event.target.value)} disabled={passwordLoading} />
        </div>
        <div className="input-group">
          <label htmlFor="confirm-password">Подтвердите пароль</label>
          <input id="confirm-password" type="password" autoComplete="new-password" required minLength={6}
            value={confirmPassword || ''} onChange={event => setConfirmPassword(event.target.value)} disabled={passwordLoading} />
        </div>
        <button type="submit" className="settings-action settings-primary" disabled={passwordLoading || !newPassword || !confirmPassword}>
          {passwordLoading ? 'Обновление…' : 'Обновить пароль'}
        </button>
        <SettingStatus status={passwordStatus} />
      </form>
    </>}
    <div className="settings-section">
      <h3 className="section-title"><ShieldCheck size={18} />Сквозное шифрование</h3>
      <dl className="settings-data-list">
        <div><dt>Состояние</dt><dd>{currentUser?.has_e2ee ? 'Активно' : 'Не настроено'}</dd></div>
        {currentUser?.has_e2ee && <div><dt>Ключ на устройстве</dt><dd>{e2eePrivateKey ? 'Разблокирован' : 'Заблокирован'}</dd></div>}
      </dl>
      <p className="settings-help">Сообщения в секретных чатах шифруются на вашем устройстве и расшифровываются на устройстве получателя.</p>
      {currentUser?.has_e2ee && <div className="input-group">
        <span className="settings-help">Отпечаток публичного ключа</span>
        <div className="settings-fingerprint">
          <code>{currentUser.public_key ? `${currentUser.public_key.substring(0, 32)}…${currentUser.public_key.slice(-24)}` : 'Отсутствует'}</code>
          {currentUser.public_key && <button type="button" className="settings-icon-button" onClick={copyKey} aria-label="Копировать ключ"><Copy size={18} /></button>}
        </div>
        <SettingStatus status={keyStatus} />
      </div>}
    </div>
    <details className="settings-section settings-technical-info">
      <summary>Технические сведения</summary>
      <dl className="settings-data-list">
        <div><dt>UUID</dt><dd className="settings-uuid">{currentUser?.id}</dd></div>
        <div><dt>Подключение</dt><dd>{isSupabaseConfigured ? 'Supabase (Live)' : 'Локальный демо-режим'}</dd></div>
      </dl>
      <p className="settings-help">Приватный ключ защищён вашим паролем. Сервер не имеет доступа к незашифрованной переписке.</p>
    </details>
    <div className="settings-section">
      <button type="button" className="settings-action settings-danger" onClick={async () => {
        if (window.confirm('Вы действительно хотите сбросить ключи шифрования? Это действие заблокирует чтение старых зашифрованных сообщений. Продолжить?')) {
          setIsSettingsOpen(false);
          const success = await resetE2EE();
          if (success) alert('Настройки E2EE успешно сброшены.');
        }
      }}><Trash2 size={18} /><span>Сбросить ключи E2EE</span></button>
    </div>
  </div>;
}
