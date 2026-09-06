import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useE2EE } from '../context/E2EEContext';
import { dataService } from '../services/dataLayer';
import { LockKeyhole, ShieldAlert, Eye, EyeOff, AlertTriangle, Info, Lock, Mail, CheckCircle2 } from 'lucide-react';

const getPasswordStrength = (pass) => {
  if (!pass) return { text: '', color: '', width: '0%' };
  let score = 0;
  if (pass.length >= 12) score += 1;
  if (/[A-Z]/.test(pass)) score += 1;
  if (/[a-z]/.test(pass)) score += 1;
  if (/[0-9]/.test(pass)) score += 1;
  if (/[^A-Za-z0-9]/.test(pass)) score += 1;
  
  if (score <= 2) return { text: 'Слабый', color: '#ff4d4f', width: '33%' };
  if (score <= 4) return { text: 'Средний', color: '#faad14', width: '66%' };
  return { text: 'Надежный', color: '#52c41a', width: '100%' };
};

export default function E2EESetupModal() {
  const { currentUser, authLoading } = useAuth();
  const {
    isE2EESetupRequired, 
    e2eePrivateKey, 
    setupE2EE, 
    unlockE2EE,
    resetE2EE
  } = useE2EE();

  // Unlock/Recover states
  const [viewMode, setViewMode] = useState('password'); // 'password', 'email_recovery'
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  // Common inputs
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  if (authLoading || !currentUser) return null;

  const needsSetup = isE2EESetupRequired;
  const needsUnlock = currentUser.has_e2ee && !e2eePrivateKey;

  if (!needsSetup && !needsUnlock) return null;

  const handleSetupPasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Пожалуйста, введите пароль.');
      return;
    }
    if (password.length < 12) {
      setError('Пароль должен содержать не менее 12 символов.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }

    setLoading(true);
    const result = await setupE2EE(password);
    setLoading(false);

    if (result && result.success) {
      setPassword('');
      setConfirmPassword('');
    } else {
      setError('Не удалось настроить шифрование. Попробуйте еще раз.');
    }
  };

  const handleUnlockPasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Введите пароль.');
      return;
    }

    setLoading(true);
    const success = await unlockE2EE(password, false);
    setLoading(false);

    if (success) {
      setPassword('');
    } else {
      setError('Неверный пароль. Пожалуйста, попробуйте снова.');
    }
  };

  const handleOpenEmailRecovery = () => {
    setViewMode('email_recovery');
    setError('');
    setEmailSent(false);
    const emailCandidate = String(currentUser?.email || '').trim();
    const isSynthetic = emailCandidate.endsWith('@coiny.users.local') || 
                        emailCandidate.endsWith('@tg-clone.com') || 
                        emailCandidate.endsWith('@demo.local');
    setRecoveryEmail(isSynthetic ? '' : emailCandidate);
  };

  const handleBackToPassword = () => {
    setViewMode('password');
    setEmailSent(false);
    setError('');
  };

  const handleEmailRecoverySubmit = async (e) => {
    e.preventDefault();
    setError('');

    const targetEmail = recoveryEmail.trim();
    if (!targetEmail) {
      setError('Пожалуйста, введите адрес электронной почты.');
      return;
    }

    setLoading(true);
    try {
      const result = await dataService.resetPasswordForEmail(targetEmail);
      if (result?.error) {
        setError(result.error.message || 'Не удалось отправить ссылку для восстановления.');
      } else {
        setEmailSent(true);
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Произошла ошибка при отправке инструкций.');
    } finally {
      setLoading(false);
    }
  };

  const handleFullReset = async () => {
    setLoading(true);
    await resetE2EE();
    setLoading(false);
    setShowResetConfirm(false);
    setViewMode('password');
    setPassword('');
    setConfirmPassword('');
    setRecoveryEmail('');
    setEmailSent(false);
    setError('');
  };

  return (
    <div className="e2ee-modal-overlay">
      <div className="e2ee-modal-content glass-card">
        {showResetConfirm ? (
          <div className="e2ee-reset-confirm-view animate-fade-in">
            <div className="e2ee-icon-container warning-glow">
              <AlertTriangle className="e2ee-header-icon reset-warn-icon" />
            </div>
            <h2>Сброс шифрования</h2>
            <p className="e2ee-subtitle danger-text">
              Внимание! Это действие безвозвратно удалит доступ к вашей истории зашифрованных сообщений. Ни вы, ни собеседники не сможете расшифровать старые переписки.
            </p>
            <div className="e2ee-notice-box" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Lock size={14} style={{ flexShrink: 0 }} />
              <span>Вы сможете продолжить общение, но доступ к старой истории переписки будет заблокирован.</span>
            </div>
            <div className="e2ee-actions-row">
              <button 
                type="button" 
                className="e2ee-cancel-btn" 
                onClick={() => setShowResetConfirm(false)}
                disabled={loading}
              >
                Отмена
              </button>
              <button 
                type="button" 
                className="e2ee-danger-confirm-btn" 
                onClick={handleFullReset}
                disabled={loading}
              >
                {loading ? <span className="spinner"></span> : 'Да, сбросить ключи'}
              </button>
            </div>
          </div>
        ) : needsSetup ? (
          /* ========================================================
             1. SETUP FLOW (Single step - activates immediately)
             ======================================================== */
          <div className="e2ee-setup-step-1 animate-scale-up">
            <div className="e2ee-modal-header">
              <div className="e2ee-icon-container setup-glow">
                <ShieldAlert className="e2ee-header-icon setup-icon" />
              </div>
              <h2>Активация сквозного шифрования</h2>
              <p className="e2ee-subtitle">
                Coiny защищает ваши личные переписки с помощью надежного E2EE-шифрования. Задайте секретный пароль для создания ключей безопасности.
              </p>
            </div>

            <form onSubmit={handleSetupPasswordSubmit} className="e2ee-form">
              {error && <div className="e2ee-error-banner">{error}</div>}

              <div className="e2ee-input-group">
                <label htmlFor="setup-password">Пароль шифрования</label>
                <div className="password-input-wrapper">
                  <input
                    id="setup-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Придумайте надежный пароль"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {password && (
                  <div className="password-strength-meter" style={{ marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                      <span>Стойкость: <strong style={{ color: getPasswordStrength(password).color }}>{getPasswordStrength(password).text}</strong></span>
                    </div>
                    <div style={{ height: '4px', width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: getPasswordStrength(password).width, backgroundColor: getPasswordStrength(password).color, transition: 'width 0.3s' }}></div>
                    </div>
                  </div>
                )}
              </div>

              <div className="e2ee-input-group">
                <label htmlFor="setup-confirm-password">Подтвердите пароль</label>
                <input
                  id="setup-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Повторите ваш пароль"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  className="styled-input"
                />
              </div>

              <div className="e2ee-warning-notice">
                <Info size={16} style={{ flexShrink: 0 }} />
                <span>
                  Этот пароль никогда не отправляется на сервер. Он используется исключительно локально на ваших устройствах.
                </span>
              </div>

              <button type="submit" className="e2ee-submit-btn" disabled={loading}>
                {loading ? <span className="spinner"></span> : 'Создать ключи шифрования'}
              </button>
            </form>
          </div>
        ) : (
          /* ========================================================
             2. UNLOCK & RECOVERY FLOW
             ======================================================== */
          viewMode === 'password' ? (
            <div className="e2ee-unlock-password animate-scale-up">
              <div className="e2ee-modal-header">
                <div className="e2ee-icon-container unlock-glow">
                  <LockKeyhole className="e2ee-header-icon unlock-icon" />
                </div>
                <h2>Разблокировка шифрования</h2>
                <p className="e2ee-subtitle">
                  Введите ваш пароль сквозного шифрования (E2EE) для дешифрования сообщений на этом устройстве.
                </p>
              </div>

              <form onSubmit={handleUnlockPasswordSubmit} className="e2ee-form">
                {error && <div className="e2ee-error-banner">{error}</div>}

                <div className="e2ee-input-group">
                  <label htmlFor="unlock-password">Пароль шифрования</label>
                  <div className="password-input-wrapper">
                    <input
                      id="unlock-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Введите ваш E2EE пароль"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={loading}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="e2ee-submit-btn" disabled={loading}>
                  {loading ? <span className="spinner"></span> : 'Разблокировать историю'}
                </button>

                <div className="e2ee-alt-actions">
                  <button 
                    type="button" 
                    className="e2ee-link-btn" 
                    onClick={handleOpenEmailRecovery}
                  >
                    Забыли пароль? Восстановить через Email
                  </button>
                  
                  <button 
                    type="button" 
                    className="e2ee-link-btn danger" 
                    onClick={() => setShowResetConfirm(true)}
                  >
                    Сбросить шифрование аккаунта
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* viewMode === 'email_recovery' */
            <div className="e2ee-unlock-recovery animate-scale-up">
              <div className="e2ee-modal-header">
                <div className="e2ee-icon-container recovery-glow">
                  <Mail className="e2ee-header-icon recovery-icon" />
                </div>
                <h2>Восстановление через Email</h2>
                <p className="e2ee-subtitle">
                  Введите адрес электронной почты для получения ссылки и инструкций по восстановлению доступа.
                </p>
              </div>

              {emailSent ? (
                <div className="e2ee-recovery-success animate-fade-in">
                  <div className="e2ee-notice-box" style={{ background: 'rgba(46, 204, 113, 0.1)', borderColor: 'rgba(46, 204, 113, 0.3)', color: '#2ecc71', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                    <span>Инструкции по восстановлению успешно отправлены на ваш email. Проверьте почтовый ящик.</span>
                  </div>

                  <button
                    type="button"
                    className="e2ee-submit-btn"
                    onClick={handleBackToPassword}
                  >
                    Вернуться к вводу пароля
                  </button>

                  <div className="e2ee-alt-actions" style={{ marginTop: '14px' }}>
                    <button 
                      type="button" 
                      className="e2ee-link-btn danger" 
                      onClick={() => setShowResetConfirm(true)}
                    >
                      Сбросить шифрование аккаунта
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleEmailRecoverySubmit} className="e2ee-form">
                  {error && <div className="e2ee-error-banner">{error}</div>}

                  <div className="e2ee-input-group">
                    <label htmlFor="recovery-email">Адрес электронной почты</label>
                    <input
                      id="recovery-email"
                      type="email"
                      placeholder="your.email@example.com"
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      disabled={loading}
                      className="styled-input"
                      autoComplete="email"
                      required
                    />
                  </div>

                  <button type="submit" className="e2ee-submit-btn" disabled={loading}>
                    {loading ? <span className="spinner"></span> : 'Отправить инструкции'}
                  </button>

                  <div className="e2ee-alt-actions">
                    <button 
                      type="button" 
                      className="e2ee-link-btn" 
                      onClick={handleBackToPassword}
                      disabled={loading}
                    >
                      Вернуться к вводу пароля
                    </button>

                    <button 
                      type="button" 
                      className="e2ee-link-btn danger" 
                      onClick={() => setShowResetConfirm(true)}
                      disabled={loading}
                    >
                      Сбросить шифрование аккаунта
                    </button>
                  </div>
                </form>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
