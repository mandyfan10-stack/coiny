import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../supabaseClient';
import coinyLogo from '../assets/logo.png';
import { 
  Lock, 
  User, 
  UserPlus, 
  LogIn, 
  AlertCircle, 
  Sparkles, 
  Eye, 
  EyeOff, 
  Check, 
  ShieldCheck, 
  Zap, 
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Shield,
  PhoneCall,
  Video,
  Smile,
  Radio
} from 'lucide-react';

const PREVIEW_SLIDES = [
  {
    id: 'e2ee',
    badge: 'Безопасность',
    icon: Shield,
    title: 'Сквозное E2EE шифрование',
    subtitle: 'Ваши сообщения и звонки защищены MLS и AES-256 GCM прямо на устройстве',
    renderVisual: () => (
      <div className="preview-visual-card preview-e2ee-visual">
        <div className="preview-shield-glow">
          <Shield size={44} className="preview-shield-icon" />
          <div className="preview-shield-halo" />
        </div>
        <div className="preview-safety-badge">
          <Lock size={12} />
          <span>Safety Number: 89365 95677 14563</span>
        </div>
        <div className="preview-crypto-tags">
          <span className="preview-tag">256-bit AES-GCM</span>
          <span className="preview-tag highlight">E2EE Private Key</span>
        </div>
      </div>
    )
  },
  {
    id: 'calls',
    badge: 'Связь',
    icon: PhoneCall,
    title: 'HD Звонки и конференции',
    subtitle: 'Чистый стерео-звук с шумоподавлением и стабильным WebRTC ICE-соединением',
    renderVisual: () => (
      <div className="preview-visual-card preview-calls-visual">
        <div className="preview-call-avatar-row">
          <div className="preview-call-avatar speaking">
            <span className="avatar-letter">🪙</span>
            <div className="preview-pulse-ring" />
          </div>
          <div className="preview-call-avatar">
            <span className="avatar-letter">👤</span>
          </div>
        </div>
        <div className="preview-audio-waveform">
          <span className="wave-bar bar-1" />
          <span className="wave-bar bar-2" />
          <span className="wave-bar bar-3" />
          <span className="wave-bar bar-4" />
          <span className="wave-bar bar-5" />
          <span className="wave-bar bar-6" />
          <span className="wave-bar bar-7" />
        </div>
        <div className="preview-call-info-badge">
          <Radio size={12} className="pulse-dot" />
          <span>WebRTC HD Audio • 02:45</span>
        </div>
      </div>
    )
  },
  {
    id: 'videonotes',
    badge: 'Медиа',
    icon: Video,
    title: 'Видеосообщения и кружочки',
    subtitle: 'Записывайте живые эмоции и отправляйте видеозаметки в один клик',
    renderVisual: () => (
      <div className="preview-visual-card preview-video-visual">
        <div className="preview-circle-video-wrap">
          <div className="preview-circle-video-inner">
            <Video size={28} className="preview-camera-icon" />
          </div>
          <svg className="preview-circle-progress" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" className="circle-track" />
            <circle cx="50" cy="50" r="46" className="circle-indicator" />
          </svg>
        </div>
        <div className="preview-video-label">
          <span className="rec-dot" />
          <span>Видеосообщение • 0:15</span>
        </div>
      </div>
    )
  },
  {
    id: 'reactions',
    badge: 'Общение',
    icon: Smile,
    title: 'Реакции и мгновенный обмен',
    subtitle: 'Делитесь реакциями, стикерами и передавайте любые файлы без ограничений',
    renderVisual: () => (
      <div className="preview-visual-card preview-reactions-visual">
        <div className="preview-floating-emojis">
          <span className="preview-emoji e1">🪙</span>
          <span className="preview-emoji e2">🔥</span>
          <span className="preview-emoji e3">❤️</span>
          <span className="preview-emoji e4">🚀</span>
          <span className="preview-emoji e5">⚡</span>
        </div>
        <div className="preview-message-bubble-mock">
          <p>Привет! Зацени новый мессенджер 🚀</p>
          <div className="preview-bubble-reactions">
            <span className="react-chip active">🪙 4</span>
            <span className="react-chip">🔥 2</span>
          </div>
        </div>
      </div>
    )
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

  // Showcase state
  const [activeSlide, setActiveSlide] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Auto-advance preview slides every 4.5s (paused on hover)
  useEffect(() => {
    if (isHovered) return undefined;
    const interval = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % PREVIEW_SLIDES.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [isHovered]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
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

  const currentSlideData = PREVIEW_SLIDES[activeSlide];
  const IconComponent = currentSlideData.icon;

  return (
    <div className="auth-screen-container">
      {/* Background glow orbs */}
      <div className="auth-glow-orb auth-glow-1" aria-hidden="true" />
      <div className="auth-glow-orb auth-glow-2" aria-hidden="true" />

      <div className="auth-split-layout">
        {/* Left Column: Interactive Telegram-style Showcase Preview */}
        <div 
          className="auth-showcase-panel"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="auth-showcase-header">
            <div className="showcase-brand">
              <div className="showcase-coin-icon">🪙</div>
              <span className="showcase-brand-name">Coiny Features</span>
            </div>
            <div className="showcase-badge">
              <IconComponent size={12} />
              <span>{currentSlideData.badge}</span>
            </div>
          </div>

          {/* Interactive animated stage */}
          <div className="auth-showcase-stage" key={currentSlideData.id}>
            {currentSlideData.renderVisual()}
          </div>

          {/* Slide Description */}
          <div className="auth-showcase-text" key={`text-${currentSlideData.id}`}>
            <h3>{currentSlideData.title}</h3>
            <p>{currentSlideData.subtitle}</p>
          </div>

          {/* Controls: Navigation Arrows & Pagination Dots */}
          <div className="auth-showcase-nav">
            <button 
              type="button" 
              className="showcase-nav-arrow" 
              onClick={() => setActiveSlide((prev) => (prev - 1 + PREVIEW_SLIDES.length) % PREVIEW_SLIDES.length)}
              aria-label="Предыдущий слайд"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="showcase-dots">
              {PREVIEW_SLIDES.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  className={`showcase-dot ${index === activeSlide ? 'active' : ''}`}
                  onClick={() => setActiveSlide(index)}
                  aria-label={`Перейти к слайду ${slide.title}`}
                />
              ))}
            </div>

            <button 
              type="button" 
              className="showcase-nav-arrow" 
              onClick={() => setActiveSlide((prev) => (prev + 1) % PREVIEW_SLIDES.length)}
              aria-label="Следующий слайд"
            >
              <ChevronRight size={16} />
            </button>
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
              <p className="auth-subtitle">Быстрый и защищённый мессенджер</p>
              <div className="auth-brand-badge">
                <Shield size={11} />
                <span>MLS • E2EE</span>
              </div>
            </div>

            {/* Demo Mode Notice Banner */}
            {!isSupabaseConfigured && (
              <div className="auth-warning-alert">
                <div className="auth-warning-header">
                  <AlertCircle size={17} className="warning-icon" />
                  <div>
                    <strong>Демонстрационный режим</strong>
                    <p>Supabase не настроен. Данные сохраняются локально.</p>
                  </div>
                </div>
                <button 
                  type="button" 
                  className="auth-demo-quick-btn"
                  onClick={async () => {
                    setLoginIdentifier('alex_dev');
                    setPassword('123456');
                    setIsLogin(true);
                    setLoading(true);
                    setErrorMsg('');
                    try {
                      const { error } = await signInWithIdentifier('alex_dev', '123456');
                      if (error) setErrorMsg(error.message);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <Zap size={14} />
                  <span>Быстрый вход (Demo)</span>
                </button>
              </div>
            )}

            {/* Feedback message banner */}
            {errorMsg && (
              <div className={`auth-error-alert ${errorMsg.includes('успешна') ? 'success' : ''}`}>
                {errorMsg.includes('успешна') ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Form Tabs Switcher */}
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${isLogin ? 'active' : ''}`}
                onClick={() => {
                  setIsLogin(true);
                  setErrorMsg('');
                }}
              >
                <LogIn size={16} />
                <span>Вход</span>
              </button>
              <button
                type="button"
                className={`auth-tab ${!isLogin ? 'active' : ''}`}
                onClick={() => {
                  setIsLogin(false);
                  setErrorMsg('');
                }}
              >
                <UserPlus size={16} />
                <span>Регистрация</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
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
                    placeholder={isLogin ? 'alex_dev или user@mail.com' : 'alex_dev'}
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
                    <Sparkles size={18} className="input-icon" />
                    <input
                      id="displayName"
                      type="text"
                      placeholder="Александр ⚡"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              {/* Password Input with Show/Hide Eye Toggle */}
              <div className="auth-input-group">
                <div className="auth-label-row">
                  <label htmlFor="password">Пароль</label>
                </div>
                <div className="auth-input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isLogin ? '••••••' : 'Введите надёжный пароль'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    aria-describedby={!isLogin ? 'password-requirements' : undefined}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                {/* Password Strength Meter & Interactive Checklist (Registration only) */}
                {!isLogin && password && (
                  <div className="auth-password-strength-box animate-fade-in">
                    <div className="auth-strength-bar-track">
                      <div 
                        className="auth-strength-bar-fill"
                        style={{ 
                          width: `${(passwordCriteria.score / 4) * 100}%`,
                          backgroundColor: passwordCriteria.strengthColor
                        }}
                      />
                    </div>
                    <div className="auth-strength-meta">
                      <span>Сложность:</span>
                      <strong style={{ color: passwordCriteria.strengthColor }}>
                        {passwordCriteria.strengthLabel}
                      </strong>
                    </div>

                    <div className="auth-requirements-list" id="password-requirements">
                      <div className={`auth-req-item ${passwordCriteria.minLength ? 'valid' : ''}`}>
                        <Check size={12} />
                        <span>От 10 символов</span>
                      </div>
                      <div className={`auth-req-item ${passwordCriteria.upperLower ? 'valid' : ''}`}>
                        <Check size={12} />
                        <span>Строчные и заглавные (a-z, A-Z)</span>
                      </div>
                      <div className={`auth-req-item ${passwordCriteria.hasDigit ? 'valid' : ''}`}>
                        <Check size={12} />
                        <span>Минимум одна цифра (0-9)</span>
                      </div>
                      <div className={`auth-req-item ${passwordCriteria.hasSpecial ? 'valid' : ''}`}>
                        <Check size={12} />
                        <span>Спецсимвол (!@#$%^&*)</span>
                      </div>
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
