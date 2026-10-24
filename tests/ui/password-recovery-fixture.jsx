import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import PasswordRecoveryScreen from '../../src/components/PasswordRecoveryScreen';
import AuthScreen from '../../src/components/AuthScreen';
import '../../src/index.css';
function Surface() {
  const auth = useAuth();
  if (auth.passwordRecovery.status !== 'idle') return <PasswordRecoveryScreen />;
  if (auth.authLoading) return <p role="status">Инициализация</p>;
  if (auth.currentUser) return <p data-testid="private-account">{auth.currentUser.id}</p>;
  return <AuthScreen />;
}
createRoot(document.getElementById('root')).render(<AuthProvider><Surface /></AuthProvider>);
