import React, { useEffect, useRef, useState } from 'react';
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { closePasswordRecovery, updateRecoveredPassword, validateRecoveryPassword } from '../utils/passwordRecovery';
import Button from './ui/Button';
import './AuthScreen.css';

export default function PasswordRecoveryScreen() {
  const { passwordRecovery } = useAuth();
  const { status, error: linkError } = passwordRecovery;
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const heading = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (status === 'ready') input.current?.focus();
    else heading.current?.focus();
  }, [status]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const validation = validateRecoveryPassword(password, confirmation);
    setError(validation);
    if (validation) return;
    setBusy(true);
    const result = await updateRecoveredPassword(supabase?.auth, password);
    if (!mounted.current) return;
    setBusy(false);
    if (result.error) setError(result.error.message);
    else { setPassword(''); setConfirmation(''); }
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await closePasswordRecovery(supabase?.auth);
    if (!mounted.current) return;
    setBusy(false);
    if (result.error) setError(result.error.message);
  };
  return (
    <main className="auth-screen-container">
      <section className="auth-card-wrapper" aria-labelledby="recovery-title">
        <div className="auth-card auth-reset-flow">
          <div>
            <h1 id="recovery-title" className="auth-reset-title" ref={heading} tabIndex={-1}>
              {status === 'complete' ? 'Пароль изменён' : 'Новый пароль'}
            </h1>
            <p className="auth-reset-subtitle">
              {status === 'verifying' ? 'Проверяем ссылку восстановления…' : status === 'complete'
                ? 'Войдите в Coiny с новым паролем.' : status === 'ready'
                  ? 'Задайте новый пароль для вашего аккаунта.' : 'Запросите новую ссылку на экране входа.'}
            </p>
          </div>
          {status === 'verifying' && <p role="status">Проверка ссылки…</p>}
          {(error || linkError) && <div className="auth-error-alert" role="alert"><AlertCircle size={20} /><span>{error || linkError}</span></div>}
          {status === 'complete' && <div className="auth-reset-success-banner" role="status"><CheckCircle2 size={20} /><span>Новый пароль сохранён.</span></div>}
          {status === 'ready' && (
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-input-group">
                <label htmlFor="recovery-password">Новый пароль</label>
                <div className="auth-input-wrapper">
                  <Lock className="input-icon" size={18} />
                  <input id="recovery-password" type="password" autoComplete="new-password" value={password} ref={input}
                    disabled={busy} required minLength={10} aria-describedby="recovery-requirements" onChange={(event) => setPassword(event.target.value)} />
                </div>
                <span id="recovery-requirements" className="auth-reset-subtitle">От 10 символов, a–z, A–Z, цифра и специальный символ.</span>
              </div>
              <div className="auth-input-group">
                <label htmlFor="recovery-confirmation">Повторите пароль</label>
                <div className="auth-input-wrapper">
                  <Lock className="input-icon" size={18} />
                  <input id="recovery-confirmation" type="password" autoComplete="new-password" value={confirmation}
                    disabled={busy} required minLength={10} onChange={(event) => setConfirmation(event.target.value)} />
                </div>
              </div>
              <Button type="submit" className="auth-submit-btn" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</Button>
            </form>
          )}
          {status !== 'verifying' && <Button variant="secondary" onClick={close} disabled={busy}>Вернуться ко входу</Button>}
        </div>
      </section>
    </main>
  );
}
