import { createClient } from '@supabase/supabase-js';
import { initializePasswordRecovery, getPasswordRecoverySnapshot } from './utils/passwordRecovery.js';
import { createBrowserAuthStorage } from './utils/authStorage.js';

// Supabase is opt-in. Without both values the app deliberately runs in the
// local mock mode described in README instead of silently connecting to a
// production project — but only outside production builds.
const viteEnv = import.meta.env || {};
const isProduction = Boolean(import.meta.env && import.meta.env.PROD);
export const supabaseProjectUrl = String(viteEnv.VITE_SUPABASE_URL || '').trim();
const supabasePublishableKey = String(
  viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  viteEnv.VITE_SUPABASE_ANON_KEY ||
  '',
).trim();

/** Explicit escape hatch for rare production demo builds without Supabase. */
export const allowMockInProduction =
  String(viteEnv.VITE_ALLOW_MOCK || '').trim().toLowerCase() === 'true' ||
  String(viteEnv.VITE_ALLOW_MOCK || '').trim() === '1';

const envForceMock =
  String(viteEnv.VITE_MOCK || viteEnv.VITE_FORCE_MOCK || '').trim().toLowerCase() === 'true' ||
  String(viteEnv.VITE_MOCK || viteEnv.VITE_FORCE_MOCK || '').trim() === '1';

const runtimeMockAllowed = !isProduction || allowMockInProduction;
const runtimeForceMock = runtimeMockAllowed && (
  (typeof window !== 'undefined' && window.location?.search && new URLSearchParams(window.location.search).get('mock') === '1')
  || (typeof window !== 'undefined' && window.localStorage?.getItem?.('coingram_force_mock') === 'true')
);

export const forceMock = envForceMock || runtimeForceMock;

const isConfigured =
  !forceMock &&
  Boolean(supabaseProjectUrl) &&
  Boolean(supabasePublishableKey) &&
  supabaseProjectUrl !== 'your-supabase-project-url' &&
  supabasePublishableKey !== 'your-supabase-publishable-key' &&
  supabasePublishableKey !== 'your-supabase-anon-key';

export const isSupabaseConfigured = !!isConfigured;

/**
 * Interactive localStorage demo. Allowed in dev always when Supabase is
 * missing, or in production only with VITE_ALLOW_MOCK=true.
 */
export const isMockMode =
  forceMock || (!isSupabaseConfigured && (!isProduction || allowMockInProduction));

/**
 * Production build shipped without Supabase credentials and without mock
 * escape hatch — must not pretend to be a working messenger.
 */
export const isMisconfigured =
  isProduction && !isSupabaseConfigured && !allowMockInProduction;

/**
 * Auth-js uses navigator.locks. A stuck lock (Electron custom protocol,
 * another Coiny tab mid-refresh) leaves "Инициализация Coiny..." forever.
 * Abort the acquire after a few seconds and run the critical section anyway.
 */
function requestAuthLock(name, acquireTimeout, execute) {
  const timeoutMs = Number.isFinite(acquireTimeout) && acquireTimeout > 0
    ? Math.min(acquireTimeout, 4000)
    : 4000;

  if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') {
    return execute();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return navigator.locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
    clearTimeout(timer);
    return execute();
  }).catch((error) => {
    clearTimeout(timer);
    if (error?.name === 'AbortError') return execute();
    throw error;
  });
}

export const authStorage = createBrowserAuthStorage(supabaseProjectUrl);
// Recovery is a temporary session even when a previous login was remembered.
if (getPasswordRecoverySnapshot().status !== 'idle') {
  // Opening an invalid link must not move/remove an existing remembered login.
  authStorage.setRememberMe(false, { savePreference: false, migrateSession: false });
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseProjectUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        storage: authStorage.storage,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        lock: requestAuthLock
      }
    })
  : null;

if (supabase) {
  const onAuthStateChange = supabase.auth.onAuthStateChange.bind(supabase.auth);
  // Auth-js broadcasts events across tabs without copying the receiving tab's
  // session storage. Only apply events belonging to this tab's actual session.
  supabase.auth.onAuthStateChange = callback => onAuthStateChange((event, session) => {
    if (authStorage.acceptsSession(session)) return callback(event, session);
  });
}

// Explicit recovery handling keeps ordinary URL fragments from establishing sessions.
void initializePasswordRecovery(supabase?.auth, () => createClient(supabaseProjectUrl, supabasePublishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'coiny-password-update' },
}).auth);
