import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Shield,
  HardDrive,
  Play,
  ThumbsUp,
  Bookmark,
  ArrowUp,
  Wifi,
  WifiOff,
  Cpu,
  Radio
} from 'lucide-react';
import { DoubleCheck, PendingClock } from './chat/messageStatusIcons';

const SCENARIOS = [
  {
    id: 'mls',
    tabLabel: 'MLS / E2EE',
    badge: 'MLS v1.0 • AES-256',
    icon: Shield,
    title: 'Сквозное шифрование',
    subtitle: 'Прямой обмен сессионными ключами между клиентами без доступа сервера к содержимому'
  },
  {
    id: 'offline',
    tabLabel: 'Офлайн-кэш',
    badge: 'IndexedDB v8',
    icon: HardDrive,
    title: 'Локальный офлайн-кэш',
    subtitle: 'Мгновенная запись сообщений в локальную базу данных и синхронизация при восстановлении сети'
  },
  {
    id: 'media',
    tabLabel: 'Медиа',
    badge: 'Opus & h.264',
    icon: Radio,
    title: 'Потоковые медиа-сообщения',
    subtitle: 'Аудиозаметки с осциллограммой и круглые видеосообщения с аппаратным декодированием'
  },
  {
    id: 'reactions',
    tabLabel: 'Реакции',
    badge: 'Realtime Broadcast',
    icon: ThumbsUp,
    title: 'Синхронизация реакций',
    subtitle: 'Мгновенный обмен откликами с репликацией статусов без блокировки основного потока диалога'
  }
];

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

  // Showcase state
  const [activeScenario, setActiveScenario] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [manualInteraction, setManualInteraction] = useState(0);
  const [offlineState, setOfflineState] = useState(true);

  const passwordInputRef = useRef(null);
  const lastToggleTimeRef = useRef(0);

  // Toggle offline/online simulation state periodically when offline scenario is active
  useEffect(() => {
    if (activeScenario !== 1) {
      setOfflineState(true);
      return undefined;
    }
    const timer = setInterval(() => {
      setOfflineState((prev) => !prev);
    }, 2400);
    return () => clearInterval(timer);
  }, [activeScenario]);

  // Auto-advance scenarios every 5s unless hovered or recently interacted
  useEffect(() => {
    if (isHovered) return undefined;
    const interval = setInterval(() => {
      if (Date.now() - manualInteraction < 8000) return;
      setActiveScenario((prev) => (prev + 1) % SCENARIOS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [isHovered, manualInteraction]);

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

  const currentScenario = SCENARIOS[activeScenario];

  return (
    <div className="auth-screen-container">
      {/* Background glow orbs */}
      <div className="auth-glow-orb auth-glow-1" aria-hidden="true" />
      <div className="auth-glow-orb auth-glow-2" aria-hidden="true" />

      <div className="auth-split-layout">
        {/* Left Column: Coiny Mini-Dialog Real Interaction Simulator */}
        <div 
          className="auth-showcase-panel"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Showcase Panel Header */}
          <div className="auth-showcase-header">
            <div className="showcase-brand">
              <Shield size={16} className="showcase-brand-icon" />
              <span className="showcase-brand-name">Coiny Architecture</span>
            </div>
            <div className="showcase-badge">
              <span>{currentScenario.badge}</span>
            </div>
          </div>

          {/* Scenario Switcher Chips */}
          <div className="mini-chat-scenario-chips" role="tablist" aria-label="Сценарии архитектуры Coiny">
            {SCENARIOS.map((sc, idx) => {
              const IconComponent = sc.icon;
              return (
                <button
                  key={sc.id}
                  type="button"
                  role="tab"
                  aria-selected={idx === activeScenario}
                  className={`scenario-chip ${idx === activeScenario ? 'active' : ''}`}
                  onClick={() => {
                    setActiveScenario(idx);
                    setManualInteraction(Date.now());
                  }}
                >
                  <IconComponent size={12} />
                  <span>{sc.tabLabel}</span>
                </button>
              );
            })}
          </div>

          {/* Mini-Chat Window Simulator */}
          <div className="mini-chat-container">
            {/* Topbar of Mini-Chat */}
            <div className="mini-chat-topbar">
              <div className="mini-chat-user">
                <div className="mini-chat-avatar">
                  <span>AD</span>
                  <span className="mini-chat-status-dot" />
                </div>
                <div className="mini-chat-user-info">
                  <div className="mini-chat-name-row">
                    <span className="mini-chat-name">Alex Developer</span>
                    <Lock size={11} className="mini-chat-verified-icon" title="MLS Verified" />
                  </div>
                  <span className="mini-chat-status-text">
                    {activeScenario === 0 && 'Ключи согласованы • MLS v1.0'}
                    {activeScenario === 1 && (offlineState ? 'Офлайн-режим • Локальный кэш' : 'Сеть подключена • Синхронизировано')}
                    {activeScenario === 2 && 'Голосовые и видеосообщения'}
                    {activeScenario === 3 && 'Код-ревью • Верификация'}
                  </span>
                </div>
              </div>
              <div className="mini-chat-engine-badge">
                <Cpu size={11} />
                <span>Client Engine</span>
              </div>
            </div>

            {/* Messages Body */}
            <div className="mini-chat-body" key={currentScenario.id}>
              {/* Scenario 0: MLS / E2EE */}
              {activeScenario === 0 && (
                <div className="mini-dialog-stage animate-fade-in">
                  <div className="mini-chat-system-badge">
                    <Lock size={10} />
                    <span>Сквозное шифрование MLS & AES-256 GCM</span>
                  </div>

                  <div className="mini-bubble incoming">
                    <div className="mini-bubble-content">
                      <span className="mini-bubble-text">
                        KeyPackage для сессии сгенерирован. Отправляю проверочный хэш.
                      </span>
                      <span className="mini-bubble-time">14:24</span>
                    </div>
                  </div>

                  <div className="mini-bubble outgoing">
                    <div className="mini-bubble-content">
                      <span className="mini-bubble-text">
                        Хэш совпадает. Симметричный ключ сессии подтвержден без участия сервера.
                      </span>
                      <div className="mini-bubble-footer">
                        <span className="mini-bubble-time">14:25</span>
                        <DoubleCheck className="mini-status-icon" />
                      </div>
                    </div>
                  </div>

                  <div className="mini-crypto-spec-card">
                    <div className="mini-crypto-row">
                      <span className="crypto-label">Протокол:</span>
                      <span className="crypto-val">MLS v1.0 (RFC 9420)</span>
                    </div>
                    <div className="mini-crypto-row">
                      <span className="crypto-label">Шифр:</span>
                      <span className="crypto-val">AES-256-GCM / SHA-256</span>
                    </div>
                    <div className="mini-crypto-row">
                      <span className="crypto-label">Safety:</span>
                      <span className="crypto-val mono">7841 9302 4419 0182</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scenario 1: Offline Cache & Instant Send */}
              {activeScenario === 1 && (
                <div className="mini-dialog-stage animate-fade-in">
                  <div className={`mini-net-indicator ${offlineState ? 'offline' : 'online'}`}>
                    {offlineState ? (
                      <>
                        <WifiOff size={11} />
                        <span>Офлайн • Сохранение в локальный кэш IndexedDB</span>
                      </>
                    ) : (
                      <>
                        <Wifi size={11} />
                        <span>Сеть восстановлена • Очередь отправлена (12 мс)</span>
                      </>
                    )}
                  </div>

                  <div className="mini-bubble incoming">
                    <div className="mini-bubble-content">
                      <span className="mini-bubble-text">
                        Сетевой шлюз недоступен. Проверь запись в локальный кэш.
                      </span>
                      <span className="mini-bubble-time">14:27</span>
                    </div>
                  </div>

                  <div className={`mini-bubble outgoing ${offlineState ? 'pending-sync' : 'synced'}`}>
                    <div className="mini-bubble-content">
                      <span className="mini-bubble-text">
                        Отправляю отчет. Запись в кэш без задержки пользовательского интерфейса.
                      </span>
                      <div className="mini-bubble-footer">
                        <span className="mini-bubble-time">14:28</span>
                        {offlineState ? (
                          <PendingClock className="mini-status-icon pending" />
                        ) : (
                          <DoubleCheck className="mini-status-icon synced" />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mini-cache-metric-row">
                    <div className="mini-metric-item">
                      <span className="metric-num">{offlineState ? '1' : '0'}</span>
                      <span className="metric-desc">В очереди</span>
                    </div>
                    <div className="mini-metric-item">
                      <span className="metric-num">0 мс</span>
                      <span className="metric-desc">Задержка UI</span>
                    </div>
                    <div className="mini-metric-item">
                      <span className="metric-num">IndexedDB</span>
                      <span className="metric-desc">Хранилище v8</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scenario 2: Media Messages (Circular Video Note & Voice Waveform) */}
              {activeScenario === 2 && (
                <div className="mini-dialog-stage animate-fade-in">
                  {/* Circular Video Note */}
                  <div className="mini-bubble outgoing media-bubble">
                    <div className="mini-video-note-wrapper">
                      <div className="mini-video-circle">
                        <svg className="mini-video-progress" viewBox="0 0 72 72">
                          <circle cx="36" cy="36" r="33" className="mini-video-track" />
                          <circle cx="36" cy="36" r="33" className="mini-video-bar" />
                        </svg>
                        <div className="mini-video-center">
                          <Play size={16} className="mini-play-icon" />
                        </div>
                        <span className="mini-video-dur">0:14</span>
                      </div>
                      <div className="mini-video-meta">
                        <span className="mini-media-title">Круглое видеосообщение</span>
                        <span className="mini-media-spec">h.264 • 60 FPS • 720p</span>
                      </div>
                    </div>
                    <div className="mini-bubble-footer">
                      <span className="mini-bubble-time">14:30</span>
                      <DoubleCheck className="mini-status-icon" />
                    </div>
                  </div>

                  {/* Audio Voice Message with Waveform */}
                  <div className="mini-bubble incoming media-bubble">
                    <div className="mini-voice-wrapper">
                      <div className="mini-voice-play-btn" aria-label="Воспроизвести аудио">
                        <Play size={12} />
                      </div>
                      <div className="mini-voice-waveform">
                        {[6, 14, 22, 10, 18, 26, 12, 20, 28, 16, 24, 14, 18, 10, 6].map((h, i) => (
                          <span
                            key={i}
                            className="mini-wave-bar"
                            style={{ height: `${h}px`, animationDelay: `${i * 0.08}s` }}
                          />
                        ))}
                      </div>
                      <span className="mini-voice-dur">0:42</span>
                    </div>
                    <div className="mini-voice-sub">
                      <span>Opus HD • 48 kHz</span>
                      <span className="mini-bubble-time">14:31</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scenario 3: Reactions (Strictly SVG icons, zero emojis) */}
              {activeScenario === 3 && (
                <div className="mini-dialog-stage animate-fade-in">
                  <div className="mini-bubble incoming">
                    <div className="mini-bubble-content">
                      <span className="mini-bubble-text">
                        Ревизия MLS ratchet протестирована, все критерии соблюдены.
                      </span>
                      <span className="mini-bubble-time">14:33</span>
                    </div>
                  </div>

                  <div className="mini-bubble outgoing">
                    <div className="mini-bubble-content">
                      <span className="mini-bubble-text">
                        Все 440 тестов пройдены успешно. Запускаем сборку клиента.
                      </span>
                      <div className="mini-bubble-footer">
                        <span className="mini-bubble-time">14:34</span>
                        <DoubleCheck className="mini-status-icon" />
                      </div>
                    </div>
                    <div className="mini-reactions-row">
                      <div className="mini-react-tag active">
                        <Check size={11} />
                        <span>4</span>
                      </div>
                      <div className="mini-react-tag active">
                        <ThumbsUp size={11} />
                        <span>2</span>
                      </div>
                      <div className="mini-react-tag">
                        <Bookmark size={11} />
                        <span>1</span>
                      </div>
                    </div>
                  </div>

                  <div className="mini-sync-stat-row">
                    <span className="mini-sync-label">Синхронизация реакций:</span>
                    <span className="mini-sync-val">Realtime Broadcast • 8 мс</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Caption and Navigation */}
            <div className="mini-chat-footer">
              <div className="auth-showcase-text">
                <h3>{currentScenario.title}</h3>
                <p>{currentScenario.subtitle}</p>
              </div>

              <div className="auth-showcase-nav">
                <button 
                  type="button" 
                  className="showcase-nav-arrow" 
                  onClick={() => {
                    setActiveScenario((prev) => (prev - 1 + SCENARIOS.length) % SCENARIOS.length);
                    setManualInteraction(Date.now());
                  }}
                  aria-label="Предыдущий сценарий"
                >
                  <ChevronLeft size={16} />
                </button>

                <div className="showcase-dots">
                  {SCENARIOS.map((sc, index) => (
                    <button
                      key={sc.id}
                      type="button"
                      className={`showcase-dot ${index === activeScenario ? 'active' : ''}`}
                      onClick={() => {
                        setActiveScenario(index);
                        setManualInteraction(Date.now());
                      }}
                      aria-label={`Перейти к сценарию ${sc.title}`}
                    />
                  ))}
                </div>

                <button 
                  type="button" 
                  className="showcase-nav-arrow" 
                  onClick={() => {
                    setActiveScenario((prev) => (prev + 1) % SCENARIOS.length);
                    setManualInteraction(Date.now());
                  }}
                  aria-label="Следующий сценарий"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Glassmorphism Auth Card */}
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
    </div>
  );
}
