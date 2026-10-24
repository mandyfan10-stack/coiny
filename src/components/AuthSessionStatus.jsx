import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Button from './ui/Button';
import './AuthScreen.css';

export default function AuthSessionStatus() {
  const { authError, retryAuthProfile, logOut } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [exitError, setExitError] = useState('');
  const leave = async () => {
    setLeaving(true);
    setExitError('');
    try {
      await logOut();
    } catch {
      setExitError('Не удалось выйти. Попробуйте ещё раз.');
    } finally {
      setLeaving(false);
    }
  };
  return <main className="auth-screen-container">
    <section className="auth-card-wrapper" aria-labelledby="auth-session-title">
      <div className="auth-card">
        <h2 id="auth-session-title">Не удалось открыть аккаунт</h2>
        <p role="alert">{exitError || authError}</p>
        <div className="auth-form">
          <Button onClick={retryAuthProfile} disabled={leaving}>Попробовать ещё раз</Button>
          <Button variant="secondary" onClick={leave} disabled={leaving}>{leaving ? 'Выходим…' : 'Выйти из аккаунта'}</Button>
        </div>
      </div>
    </section>
  </main>;
}
