import React from 'react';
import {
  Copy,
  Trash2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Info,
  ShieldCheck
} from 'lucide-react';
import { isSupabaseConfigured } from '../../supabaseClient';

export default function E2EETab({
  currentUser,
  e2eePrivateKey,
  setIsSettingsOpen,
  resetE2EE,
  email,
  setEmail,
  emailStatus,
  emailLoading,
  emailEditable,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  passwordStatus,
  passwordLoading,
  handlePasswordChange
}) {
  return (
    <div className="settings-e2ee-tab" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Auth & Account Security */}
      {isSupabaseConfigured && (
        <div className="settings-section">
          <h5 className="section-title">
            <KeyRound size={16} />
            <span>Вход и учётная запись</span>
          </h5>

          {/* Email change */}
          <div className="input-group">
            <label htmlFor="settings-email-input">Email аккаунта</label>
            <input
              id="settings-email-input"
              type="email"
              value={email || ''}
              onChange={(e) => setEmail?.(e.target.value)}
              placeholder="you@example.com"
              disabled={!emailEditable || emailLoading}
            />
            <span className="input-help-text">После изменения потребуется подтвердить новый адрес по ссылке из письма.</span>
            {emailStatus?.text && (
              <div
                className="password-status-msg"
                style={{
                  marginTop: '8px',
                  fontSize: '12.5px',
                  fontWeight: '500',
                  color: emailStatus.type === 'error' ? '#ff4d4f' : '#2ecc71',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {emailStatus.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
                <span>{emailStatus.text}</span>
              </div>
            )}
          </div>

          {/* Password change */}
          <form onSubmit={handlePasswordChange} className="password-change-form" style={{ marginTop: '12px' }}>
            <div className="input-group">
              <label htmlFor="new-password">Новый пароль</label>
              <input
                id="new-password"
                type="password"
                placeholder="Минимум 6 символов"
                value={newPassword || ''}
                onChange={(e) => setNewPassword?.(e.target.value)}
                required
              />
            </div>
            <div className="input-group" style={{ marginTop: '10px' }}>
              <label htmlFor="confirm-password">Подтвердите пароль</label>
              <input
                id="confirm-password"
                type="password"
                placeholder="Повторите пароль"
                value={confirmPassword || ''}
                onChange={(e) => setConfirmPassword?.(e.target.value)}
                required
              />
            </div>
            {passwordStatus?.text && (
              <div
                className="password-status-msg"
                style={{
                  marginTop: '8px',
                  fontSize: '12.5px',
                  fontWeight: '500',
                  color: passwordStatus.type === 'error' ? '#ff4d4f' : '#2ecc71',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {passwordStatus.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
                <span>{passwordStatus.text}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={passwordLoading || !newPassword || !confirmPassword}
              className="btn-primary auth-submit-btn"
              style={{ marginTop: '12px', padding: '8px 16px', fontSize: '13px', width: 'auto' }}
            >
              {passwordLoading ? 'Обновление...' : 'Обновить пароль'}
            </button>
          </form>
        </div>
      )}

      {/* 2. End-to-End Encryption (E2EE) */}
      <div className="settings-section e2ee-overview-section">
        <h5 className="section-title">
          <ShieldCheck size={16} />
          <span>Сквозное шифрование (E2EE)</span>
        </h5>
        <p className="section-desc" style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
          Сообщения в секретных чатах шифруются на вашем устройстве и расшифровываются только на устройстве получателя.
        </p>

        <div className="e2ee-status-card glass-panel" style={{ marginTop: '10px' }}>
          <div className="status-row">
            <span className="status-label">Статус E2EE:</span>
            <span className={`status-badge ${currentUser?.has_e2ee ? 'active' : 'inactive'}`}>
              {currentUser?.has_e2ee ? 'Активно' : 'Не настроено'}
            </span>
          </div>
          {currentUser?.has_e2ee && (
            <>
              <div className="status-row">
                <span className="status-label">Ключи в RAM:</span>
                <span className={`status-badge ${e2eePrivateKey ? 'active' : 'inactive'}`}>
                  {e2eePrivateKey ? 'Разблокированы' : 'Заблокированы'}
                </span>
              </div>
              <div className="key-fingerprint-box">
                <span className="fingerprint-label">Ваш публичный ключ (fingerprint):</span>
                <div className="fingerprint-wrapper">
                  <code className="fingerprint-code">
                    {currentUser.public_key
                      ? `${currentUser.public_key.substring(0, 32)}...${currentUser.public_key.substring(currentUser.public_key.length - 24)}`
                      : 'Отсутствует'}
                  </code>
                  {currentUser.public_key && (
                    <button
                      type="button"
                      className="fingerprint-copy-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(currentUser.public_key);
                        alert('Публичный ключ скопирован!');
                      }}
                      title="Копировать ключ"
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="settings-section e2ee-info-card warning-accent">
        <h6 className="info-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', margin: 0 }}>
          <AlertCircle size={14} />
          <span>Безопасность ключей</span>
        </h6>
        <p className="info-desc" style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0 0', lineHeight: '1.4' }}>
          Приватный ключ защищён вашим паролем. Сервер не имеет доступа к незашифрованной переписке.
        </p>
      </div>

      {/* 3. Session Info & Data Management */}
      <div className="settings-section">
        <h5 className="section-title">
          <Info size={16} />
          <span>Системная информация и сессия</span>
        </h5>
        <div
          className="session-info-details"
          style={{
            backgroundColor: 'var(--bg-input)',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            fontSize: '12.5px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div className="session-info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Ваш UUID:</span>
            <span
              className="select-all-text session-info-value"
              style={{ fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all' }}
            >
              {currentUser?.id}
            </span>
          </div>
          <div className="session-info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Режим подключения:</span>
            <span className="session-info-value" style={{ fontWeight: '600', color: isSupabaseConfigured ? '#0f9d58' : '#d97706' }}>
              {isSupabaseConfigured ? 'Supabase (Live)' : 'Локальный демо-режим'}
            </span>
          </div>
        </div>
      </div>

      {/* Reset E2EE Keys */}
      <div className="settings-section e2ee-reset-section">
        <h5 className="section-title danger-title">
          <Trash2 size={16} />
          <span>Сброс ключей шифрования</span>
        </h5>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            type="button"
            className="e2ee-reset-action-btn"
            onClick={async () => {
              if (
                window.confirm(
                  'Вы действительно хотите сбросить ключи шифрования? Это действие заблокирует чтение старых зашифрованных сообщений. Продолжить?'
                )
              ) {
                setIsSettingsOpen(false);
                const success = await resetE2EE();
                if (success) {
                  alert('Настройки E2EE успешно сброшены.');
                }
              }
            }}
          >
            <Trash2 size={15} />
            <span>Сбросить ключи E2EE</span>
          </button>
        </div>
      </div>
    </div>
  );
}
