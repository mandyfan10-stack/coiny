import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import AuthScreen from '../../src/components/AuthScreen';
import AuthSessionStatus from '../../src/components/AuthSessionStatus';
import { dataService } from '../../src/services/dataLayer';
import { supabase } from '../../src/supabaseClient';
import '../../src/index.css';

// Deterministic SDK boundary for session event ordering; actual providers and UI.
const fixture = { bootstraps: [], profiles: [], mode: 'success' };
window.__authSession = fixture;
dataService.isLive = () => true;
supabase.auth.getSession = () => new Promise(resolve => fixture.bootstraps.push(resolve));
supabase.auth.onAuthStateChange = callback => {
  fixture.event = callback;
  return { data: { subscription: { unsubscribe() {} } } };
};
dataService.fetchProfile = async id => {
  if (fixture.mode === 'error') throw new Error('Synthetic profile network failure');
  if (fixture.mode === 'missing') return null;
  if (fixture.mode === 'pending') return new Promise(resolve => fixture.profiles.push({ id, resolve }));
  return { id, username: id, display_name: id };
};
dataService.signIn = async id => {
  fixture.event('SIGNED_IN', { user: { id } });
  return { data: { id } };
};
dataService.signOut = async () => {
  fixture.event('SIGNED_OUT', null);
  if (fixture.holdSignOut) await new Promise(resolve => { fixture.finishSignOut = resolve; });
};
supabase.auth.updateUser = () => new Promise(resolve => {fixture.finishEmail = value => resolve(value);});
function Surface() {
  const auth = useAuth();
  fixture.auth = auth;
  if (auth.authLoading) return <p role="status">Загружаем аккаунт…</p>;
  if (auth.authError && !auth.currentUser) return <AuthSessionStatus />;
  if (!auth.currentUser) return <AuthScreen />;
  return <p data-testid="owner">{auth.currentUser.id}</p>;
}
createRoot(document.getElementById('root')).render(<AuthProvider><Surface /></AuthProvider>);
