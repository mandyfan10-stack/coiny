import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { dataService } from '../services/dataLayer';
import { clearLocalAppData } from '../utils/localDataCleanup.js';

const AuthContext = createContext();

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

  // Listen to auth changes (Supabase vs Mock)
  useEffect(() => {
    if (dataService.isLive()) {
      let cancelled = false;
      let authRequestId = 0;

      const applySession = (session) => {
        const requestId = ++authRequestId;

        if (!session) {
          setCurrentUser(previousUser => {
            if (previousUser?.id) {
              void clearLocalAppData().catch((error) => {
                console.warn('Failed to clear local application data after session loss:', error);
              });
            }
            return null;
          });
          setAuthLoading(false);
          return;
        }

        // Supabase warns against awaiting other client calls directly inside
        // onAuthStateChange because it can deadlock the auth client.
        setTimeout(async () => {
          try {
            const profile = await withTimeout(
              dataService.fetchProfile(session.user.id),
              AUTH_PROFILE_TIMEOUT_MS,
              'fetchProfile'
            );
            if (cancelled || requestId !== authRequestId) return;
            if (!profile) {
              await supabase.auth.signOut({ scope: 'local' });
              return;
            }

            setCurrentUser({
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
              public_key: profile.public_key
            });
          } catch (error) {
            if (!cancelled && requestId === authRequestId) {
              const errorCode = error?.code ? ` [${error.code}]` : '';
              console.error(`Failed to load authenticated profile${errorCode}: ${error?.message || String(error)}`);
            }
          } finally {
            if (!cancelled && requestId === authRequestId) {
              setAuthLoading(false);
            }
          }
        }, 0);
      };

      // Recover the persisted session immediately. INITIAL_SESSION from the
      // listener can stall behind navigator.locks / token refresh.
      supabase.auth.getSession()
        .then(({ data }) => {
          if (!cancelled) applySession(data?.session ?? null);
        })
        .catch((error) => {
          console.warn('Auth session bootstrap failed:', error);
        });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        applySession(session);
      });

      const bootstrapTimer = setTimeout(() => {
        if (cancelled) return;
        setAuthLoading((stillLoading) => {
          if (stillLoading) {
            console.warn('Auth bootstrap timed out; showing the login screen.');
          }
          return false;
        });
      }, AUTH_BOOTSTRAP_TIMEOUT_MS);

      return () => {
        cancelled = true;
        authRequestId += 1;
        clearTimeout(bootstrapTimer);
        subscription?.unsubscribe();
      };
    } else {
      // Mock mode
      const savedUser = localStorage.getItem('tg-user-mock');
      if (savedUser) {
        try {
          setCurrentUser(JSON.parse(savedUser));
        } catch (e) {
          console.warn(e);
        }
      }
      setAuthLoading(false);
    }
  }, []);
  const signUpWithUsername = async (username, password, displayName) => {
    return await dataService.signUp(username, password, displayName);
  };

  const signInWithIdentifier = async (identifier, password) => {
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

    const { data, error } = await supabase.auth.updateUser({ email: normalizedEmail });
    if (error) return { error };

    setCurrentUser(previous => previous ? {
      ...previous,
      email: data.user?.email || normalizedEmail
    } : previous);
    return { data };
  };

  const resetPasswordForEmail = async (emailOrUsername) => {
    return await dataService.resetPasswordForEmail(emailOrUsername);
  };

  const logOut = async () => {
    await dataService.signOut();
    try {
      await clearLocalAppData();
    } finally {
      setCurrentUser(null);
    }
  };

  const updateProfile = async (fields) => {
    if (!currentUser) return;
    try {
      await dataService.updateProfile(currentUser.id, fields);
      setCurrentUser(prev => ({ ...prev, ...fields }));
    } catch (e) {
      console.error("Profile update failed", e);
    }
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      setCurrentUser,
      authLoading,
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
