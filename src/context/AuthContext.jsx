import React, { createContext, useContext, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { supabase, authStorage } from '../supabaseClient';
import { dataService } from '../services/dataLayer';
import { getPasswordRecoverySnapshot, subscribePasswordRecovery } from '../utils/passwordRecovery.js';
import { clearLocalAppData } from '../utils/localDataCleanup.js';

export const AuthContext = createContext();

const AUTH_BOOTSTRAP_TIMEOUT_MS = 4_000;
const AUTH_PROFILE_TIMEOUT_MS = 3_500;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const retryProfileRef = useRef(() => {});
  const authGenerationRef = useRef(0);
  const accountActivityRef = useRef(0);
  const passwordRecovery = useSyncExternalStore(subscribePasswordRecovery, getPasswordRecoverySnapshot);
  const retryAuthProfile = () => retryProfileRef.current();

  // Listen to auth changes (Supabase vs Mock)
  useEffect(() => {
    if (dataService.isLive()) {
      let cancelled = false;
      let authRequestId = 0;
      let authEventVersion = 0;
      let receivedLiveEvent = false;
      let latestSession = null;
      let pendingCleanup = Promise.resolve();
      const clearPreviousAccount = () => {
        pendingCleanup = pendingCleanup.then(() => clearLocalAppData()).catch((error) => {
          console.warn('Failed to clear local application data after session loss:', error);
        });
      };
      const applySession = (session) => {
        const requestId = ++authRequestId;
        if (session) accountActivityRef.current += 1;
        if (latestSession?.user.id !== session?.user.id) authGenerationRef.current += 1;
        latestSession = session;
        const previousUser = currentUserRef.current;
        const recoveryActive = getPasswordRecoverySnapshot().status !== 'idle';
        if (!session || recoveryActive || previousUser?.id !== session.user.id) {
          currentUserRef.current = null;
          setCurrentUser(null);
          if (previousUser?.id) clearPreviousAccount();
        }
        setAuthError(null);
        if (!session || recoveryActive) {
          setAuthLoading(false);
          return;
        }
        if (!currentUserRef.current) setAuthLoading(true);

        // Keep client calls outside the synchronous Supabase auth callback.
        setTimeout(async () => {
          try {
            await pendingCleanup;
            if (cancelled || requestId !== authRequestId) return;
            const profile = await withTimeout(
              dataService.fetchProfile(session.user.id),
              AUTH_PROFILE_TIMEOUT_MS,
              'fetchProfile'
            );
            if (cancelled || requestId !== authRequestId) return;
            if (!profile) throw new Error('Профиль аккаунта не найден.');

            const user = {
              id: profile.id,
              email: session.user.email || '',
              name: profile.display_name,
              username: profile.username,
              avatarColor: profile.avatar_color,
              bio: profile.bio,
              theme: profile.theme,
              wallpaper: profile.wallpaper,
              avatar: profile.avatar,
              banner: profile.banner,
              has_e2ee: profile.has_e2ee,
              public_key: profile.public_key,
              notificationsEnabled: localStorage.getItem(`coingram-notifications-${profile.id}`) !== 'false'
            };
            currentUserRef.current = user;
            setCurrentUser(user);
          } catch (error) {
            if (!cancelled && requestId === authRequestId) {
              console.error('Failed to load authenticated profile:', error?.message || String(error));
              // A refresh failure must not remove an already loaded account.
              if (!currentUserRef.current) {
                setAuthError('Не удалось загрузить профиль. Проверьте соединение и попробуйте ещё раз.');
              }
            }
          } finally {
            if (!cancelled && requestId === authRequestId) setAuthLoading(false);
          }
        }, 0);
      };
      const recoverSession = () => {
        const bootstrapVersion = authEventVersion;
        setAuthError(null);
        setAuthLoading(true);
        return withTimeout(supabase.auth.getSession(), AUTH_BOOTSTRAP_TIMEOUT_MS, 'getSession')
          .then(({ data, error }) => {
            if (cancelled || bootstrapVersion !== authEventVersion) return;
            if (error) throw error;
            applySession(data?.session ?? null);
          })
          .catch((error) => {
            if (cancelled || bootstrapVersion !== authEventVersion) return;
            console.warn('Auth session bootstrap failed:', error);
            setAuthError('Не удалось восстановить вход. Проверьте соединение и попробуйте ещё раз.');
            setAuthLoading(false);
          });
      };
      retryProfileRef.current = () => latestSession ? applySession(latestSession) : recoverSession();
      // A bootstrap snapshot is only valid until the first newer auth event.
      void recoverSession();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' && receivedLiveEvent) return;
        if (event !== 'INITIAL_SESSION') receivedLiveEvent = true;
        authEventVersion += 1;
        applySession(session);
      });
      return () => {
        cancelled = true;
        authRequestId += 1;
        retryProfileRef.current = () => {};
        subscription?.unsubscribe();
      };
    } else {
      // Mock mode
      const savedUser = localStorage.getItem('tg-user-mock');
      if (savedUser) {
        try {
          const user = JSON.parse(savedUser);
          const notifications = localStorage.getItem(`coingram-notifications-${user.id}`);
          setCurrentUser({ ...user, ...(notifications !== null ? { notificationsEnabled: notifications !== 'false' } : {}) });
        } catch (e) {
          console.warn(e);
        }
      }
      setAuthLoading(false);
    }
  }, []);
  const signUpWithUsername = async (username, password, displayName, options = {}) => {
    if (typeof options.rememberMe === 'boolean') authStorage.setRememberMe(options.rememberMe);
    return await dataService.signUp(username, password, displayName);
  };

  const signInWithIdentifier = async (identifier, password, options = {}) => {
    if (typeof options.rememberMe === 'boolean') authStorage.setRememberMe(options.rememberMe);
    const result = await dataService.signIn(identifier, password);
    if (result.data && !dataService.isLive()) {
      setCurrentUser(result.data);
    }
    return result;
  };

  const signInWithUsername = signInWithIdentifier;

  const updateEmail = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return { error: new Error('Email не может быть пустым.') };
    }
    if (!dataService.isLive()) {
      return { error: new Error('Изменение email доступно только в live-режиме Supabase.') };
    }

    const ownerId = currentUser?.id;
    const generation = authGenerationRef.current;
    if (!ownerId) return { cancelled: true };
    const { data, error } = await supabase.auth.updateUser({ email: normalizedEmail });
    if (generation !== authGenerationRef.current || currentUserRef.current?.id !== ownerId) return { cancelled: true };
    if (error) return { error };

    setCurrentUser(previous => generation === authGenerationRef.current && previous?.id === ownerId ? {
      ...previous,
      email: data.user?.email || normalizedEmail
    } : previous);
    return { data };
  };

  const resetPasswordForEmail = async (emailOrUsername) => {
    return await dataService.resetPasswordForEmail(emailOrUsername);
  };

  const logOut = async () => {
    const activity = accountActivityRef.current;
    authGenerationRef.current += 1;
    await dataService.signOut();
    if (activity !== accountActivityRef.current) return { cancelled: true };
    try {
      await clearLocalAppData();
    } finally {
      if (activity === accountActivityRef.current) {
        currentUserRef.current = null;
        setCurrentUser(previous => activity === accountActivityRef.current ? null : previous);
        setAuthError(null);
      }
    }
  };

  const updateProfile = async (fields) => {
    if (!currentUser) return;
    try {
      // Notification permission is device-specific; profiles has no notification column.
      // Keep its existing updateProfile entry point without sending an empty server PATCH.
      const { notificationsEnabled, ...profileFields } = fields;
      if (Object.keys(profileFields).length) await dataService.updateProfile(currentUser.id, profileFields);
      if (typeof notificationsEnabled === 'boolean') {
        localStorage.setItem(`coingram-notifications-${currentUser.id}`, String(notificationsEnabled));
      }
      setCurrentUser(prev => prev?.id === currentUser.id ? { ...prev, ...fields } : prev);
    } catch (e) {
      console.error("Profile update failed", e);
      return { error: e };
    }
    return { data: true };
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      setCurrentUser,
      authLoading,
      authError,
      retryAuthProfile,
      passwordRecovery,
      signUpWithUsername,
      signInWithIdentifier,
      signInWithUsername,
      resetPasswordForEmail,
      resetPassword: resetPasswordForEmail,
      updateEmail,
      logOut,
      updateProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
