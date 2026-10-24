import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import AuthScreen from '../../src/components/AuthScreen';
import AuthSessionStatus from '../../src/components/AuthSessionStatus';
import PasswordRecoveryScreen from '../../src/components/PasswordRecoveryScreen';
import '../../src/index.css';

// Real auth SDK, provider and UI. Tests intercept only HTTP requests.
function Surface() {
  const auth = useAuth();
  if (auth.passwordRecovery.status !== 'idle') return <PasswordRecoveryScreen />;
  if (auth.authLoading) return <p role="status">Загружаем аккаунт…</p>;
  if (auth.authError && !auth.currentUser) return <AuthSessionStatus />;
  if (!auth.currentUser) return <AuthScreen />;
  return <section>
    <p data-testid="owner">{auth.currentUser.id}</p>
    <button onClick={auth.logOut}>Выйти</button>
  </section>;
}
createRoot(document.getElementById('root')).render(<AuthProvider><Surface /></AuthProvider>);
