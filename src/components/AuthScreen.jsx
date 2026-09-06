import React, { useState, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../supabaseClient';
import coinyLogo from '../assets/logo.png';
import { 
  Lock, 
  User, 
  UserPlus, 
  LogIn, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  Check, 
  ShieldCheck, 
  Zap, 
  CheckCircle2,
  Shield,
  ArrowUp
} from 'lucide-react';

export default function AuthScreen() {
  const { signInWithIdentifier, signUpWithUsername } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);

  const passwordInputRef = useRef(null);
  const lastToggleTimeRef = useRef(0);

  // Real-time password requirement analysis for registration
  const passwordCriteria = useMemo(() => {
    const minLength = password.length >= 10;
    const upperLower = /[a-z]/.test(password) && /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    
    let score = 0;
    if (minLength) score++;
    if (upperLower) score++;
    if (hasDigit) score++;
    if (hasSpecial) score++;

    let strengthLabel = 'Слабый';
    let strengthColor = '#ef4444';
    if (score === 4) {
      strengthLabel = 'Надёжный';
      strengthColor = '#10b981';
    } else if (score >= 2) {
      strengthLabel = 'Средний';
      strengthColor = '#f59e0b';
    }

    return {
      minLength,
      upperLower,
      hasDigit,
      hasSpecial,
      score,
      strengthLabel,
      strengthColor
    };
  }, [password]);

  // Concise unmet password requirements for registration
  const unmetHints = useMemo(() => {
    const hints = [];
    if (!passwordCriteria.minLength) hints.push('от 10 символов');
    if (!passwordCriteria.upperLower) hints.push('a-z и A-Z');
    if (!passwordCriteria.hasDigit) hints.push('цифра');
    if (!passwordCriteria.hasSpecial) hints.push('спецсимвол');
    return hints;
  }, [passwordCriteria]);

  const handlePasswordKey = (e) => {
    if (e.getModifierState) {
      setCapsLockActive(e.getModifierState('CapsLock'));
    }
  };

  const handleTogglePassword = (e) => {
    // Prevent focus loss from password input
    if (e?.preventDefault) {
      e.preventDefault();
    }
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 250) {
      return;
    }
    lastToggleTimeRef.current = now;
    setShowPassword((prev) => !prev);
    if (passwordInputRef.current) {
      passwordInputRef.current.focus();
      try {
        const len = passwordInputRef.current.value.length;
        passwordInputRef.current.setSelectionRange(len, len);
      } catch {
        // Ignore environments where setSelectionRange is unsupported
      }
    }
  };

  const handleDemoLogin = async () => {
    if (loading) return;
    setLoginIdentifier('alex_dev');
    setPassword('123456');
    setIsLogin(true);
    setLoading(true);
    setErrorMsg('');
    try {
      const { error } = await signInWithIdentifier('alex_dev', '123456');
      if (error) setErrorMsg(error.message);
    } catch (err) {
      console.error(err);
      setErrorMsg('Ошибка входа в демо-режиме.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setErrorMsg('');

    const identifier = (isLogin ? loginIdentifier : username).trim();

    if (!identifier || !password.trim()) {
      setErrorMsg('Пожалуйста, заполните все обязательные поля.');
      return;
    }

    if (!isLogin || !identifier.includes('@')) {
      if (identifier.length < 3) {
        setErrorMsg('Имя пользователя должно быть не менее 3 символов.');
        return;
      }

      if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
        setErrorMsg('Имя пользователя: только латиница, цифры и _.');
        return;
      }
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      setErrorMsg('Укажите корректный email или никнейм.');
      return;
    }

    if (!isLogin) {
      if (!passwordCriteria.minLength) {
        setErrorMsg('Пароль должен быть не менее 10 символов.');
        return;
      }

      if (!passwordCriteria.upperLower || !passwordCriteria.hasDigit || !passwordCriteria.hasSpecial) {
        setErrorMsg('Пароль должен содержать строчную и заглавную буквы, цифру и специальный символ.');
        return;
      }
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signInWithIdentifier(identifier.toLowerCase(), password);
        if (error) {
          setErrorMsg(error.message || 'Ошибка при входе. Проверьте логин и пароль.');
        }
      } else {
        const { error } = await signUpWithUsername(
          username.trim().toLowerCase(),
          password,
          displayName.trim() || username.trim()
        );
        if (error) {
          setErrorMsg(error.message || 'Ошибка при регистрации. Возможно, имя пользователя уже занято.');
        } else {
          setIsLogin(true);
          setPassword('');
          setErrorMsg('Регистрация успешна! Теперь вы можете войти в систему.');
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Произошла непредвиденная ошибка. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen-container">
      {/* Background glow orbs */}
      <div className="auth-glow-orb auth-glow-1" aria-hidden="true" />
      <div className="auth-glow-orb auth-glow-2" aria-hidden="true" />

      {/* Glassmorphism Auth Card */}
      <div className="auth-card-wrapper">
        <div className="auth-card">
            {/* Logo Branding Section */}
            <div className="auth-logo-section">
              <div className="auth-logo-svg-wrapper">
                <div className="auth-logo-halo" />
                <img src={coinyLogo} alt="Coiny" className="auth-logo-img" width="76" height="76" />
              </div>
              <h2>Coiny</h2>
              <p className="auth-subtitle">Защищённый клиент обмена сообщениями</p>
              <div className="auth-brand-badge">
                <Shield size={11} />
                <span>MLS v1.0 • E2EE</span>
              </div>
            </div>

            {/* Feedback message banner */}
            {errorMsg && (
              <div className={`auth-error-alert ${errorMsg.includes('успешна') ? 'success' : ''}`}>
                {errorMsg.includes('успешна') ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Segmented Switcher with Sliding Pill Indicator */}
            <div className="auth-tabs" role="tablist">
              <div 
                className={`auth-tabs-slider ${!isLogin ? 'is-register' : 'is-login'}`}
                aria-hidden="true"
              />
              <button
                type="button"
                role="tab"
                aria-selected={isLogin}
                className={`auth-tab ${isLogin ? 'active' : ''}`}
                onClick={() => {
                  setIsLogin(true);
                  setErrorMsg('');
                }}
              >
                <LogIn size={15} />
                <span>Вход</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isLogin}
                className={`auth-tab ${!isLogin ? 'active' : ''}`}
                onClick={() => {
                  setIsLogin(false);
                  setErrorMsg('');
                }}
              >
                <UserPlus size={15} />
                <span>Регистрация</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form" noValidate={false}>
              {/* Identifier input (login: email/username, register: username) */}
              <div className="auth-input-group">
                <label htmlFor={isLogin ? 'loginIdentifier' : 'username'}>
                  {isLogin ? 'Email или никнейм' : 'Никнейм (username)'}
                </label>
                <div className="auth-input-wrapper">
                  <User size={18} className="input-icon" />
                  <input
                    id={isLogin ? 'loginIdentifier' : 'username'}
                    type="text"
                    placeholder={isLogin ? 'alex_dev или user@domain.com' : 'alex_dev'}
                    value={isLogin ? loginIdentifier : username}
                    onChange={(e) => (isLogin ? setLoginIdentifier(e.target.value) : setUsername(e.target.value))}
                    disabled={loading}
                    autoComplete={isLogin ? 'username' : 'new-username'}
                    required
                  />
                </div>
              </div>

              {/* Display Name Input (Registration only) */}
              {!isLogin && (
                <div className="auth-input-group animate-fade-in">
                  <label htmlFor="displayName">Отображаемое имя (необязательно)</label>
                  <div className="auth-input-wrapper">
                    <User size={18} className="input-icon" />
                    <input
                      id="displayName"
                      type="text"
                      placeholder="Александр"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              {/* Password Input with Caps Lock detector and focus retention toggle */}
              <div className="auth-input-group">
                <div className="auth-label-row">
                  <label htmlFor="password">Пароль</label>
                  {capsLockActive && (
                    <span className="auth-capslock-indicator" role="status">
                      <ArrowUp size={11} />
                      <span>Caps Lock</span>
                    </span>
                  )}
                </div>
                <div className="auth-input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    ref={passwordInputRef}
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isLogin ? '••••••' : 'Введите надёжный пароль'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handlePasswordKey}
                    onKeyUp={handlePasswordKey}
                    onClick={handlePasswordKey}
                    onFocus={handlePasswordKey}
                    onBlur={() => setCapsLockActive(false)}
                    disabled={loading}
                    aria-describedby={!isLogin ? 'password-requirements' : undefined}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle-btn"
                    onMouseDown={handleTogglePassword}
                    onClick={handleTogglePassword}
                    tabIndex={-1}
                    title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* 4-Segment Password Strength Progress Bar & Concise Hints (Registration only) */}
                {!isLogin && password && (
                  <div className="auth-password-strength-box animate-fade-in" id="password-requirements">
                    <div className="auth-strength-header-row">
                      <span className="auth-strength-label-text">Надёжность пароля</span>
                      <strong style={{ color: passwordCriteria.strengthColor }}>
                        {passwordCriteria.strengthLabel}
                      </strong>
                    </div>

                    <div className="auth-strength-segments" aria-hidden="true">
                      {[1, 2, 3, 4].map((level) => (
                        <div
                          key={level}
                          className={`auth-strength-segment ${passwordCriteria.score >= level ? 'filled' : ''}`}
                          style={{
                            backgroundColor: passwordCriteria.score >= level ? passwordCriteria.strengthColor : undefined
                          }}
                        />
                      ))}
                    </div>

                    <div className="auth-requirements-compact">
                      {unmetHints.length > 0 ? (
                        <div className="auth-req-tags-row">
                          <span className="auth-req-label">Требуется:</span>
                          <div className="auth-req-tags">
                            {unmetHints.map((hint, idx) => (
                              <span key={idx} className="auth-req-tag">{hint}</span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="auth-req-all-valid">
                          <Check size={12} className="auth-req-valid-icon" />
                          <span>Все требования к паролю соблюдены</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Remember Me Toggle */}
              {isLogin && (
                <div className="auth-extra-row">
                  <label className="auth-remember-label">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    <span>Запомнить меня</span>
                  </label>
                </div>
              )}

              {/* Submit Button */}
              <button type="submit" className="auth-submit-btn" disabled={loading}>
                {loading ? (
                  <span className="spinner"></span>
                ) : isLogin ? (
                  <>
                    <LogIn size={18} />
                    <span>Войти в аккаунт</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={18} />
                    <span>Создать аккаунт</span>
                  </>
                )}
              </button>

              {/* Compact Demo Mode Button positioned below main submit button */}
              {!isSupabaseConfigured && (
                <div className="auth-demo-compact-section">
                  <button 
                    type="button" 
                    className="auth-demo-quick-btn"
                    onClick={handleDemoLogin}
                    disabled={loading}
                    title="Вход в демонстрационном режиме с локальным профилем"
                  >
                    <Zap size={14} />
                    <span>Быстрый вход в демо-режим (alex_dev)</span>
                  </button>
                  <span className="auth-demo-subtext">Локальный профиль без сетевой синхронизации</span>
                </div>
              )}
            </form>

            {/* Footer Security Badge */}
            <div className="auth-footer-security">
              <ShieldCheck size={14} className="security-shield-icon" />
              <span>Сквозное E2EE шифрование</span>
              <span className="security-live-dot" title="MLS & AES-256 GCM" />
            </div>
        </div>
      </div>
    </div>
  );
}
