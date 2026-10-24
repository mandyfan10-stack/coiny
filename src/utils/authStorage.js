/** Supabase storage with an explicit browser-session or persistent lifetime. */
export function createAuthStorageAdapter({ storageKey, localStorage: persistent, sessionStorage: temporary } = {}) {
  const preferenceKey = `coiny-auth-remember-${storageKey}`;
  const modeKey = `coiny-auth-mode-${storageKey}`;
  const memory = new Map();
  const knownKeys = new Set([storageKey]);
  let removingSession = null;
  const read = (store, key) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
  const remove = (store, key) => { try { store?.removeItem(key); } catch { /* storage may be disabled */ } };
  const write = (store, key, value) => {
    try { if (store) { store.setItem(key, value); return true; } } catch { /* fall back to memory */ }
    return false;
  };
  const storedMode = read(temporary, modeKey);
  let remember = storedMode !== null
    ? storedMode !== 'false'
    : read(persistent, storageKey) !== null || read(persistent, preferenceKey) !== 'false';
  const target = () => remember ? persistent : temporary;
  const other = () => remember ? temporary : persistent;
  const sameSessionOwner = (left, right) => {
    if (!left || !right) return false;
    if (left === right) return true;
    try {
      const a = JSON.parse(left);
      const b = JSON.parse(right);
      return Boolean(a?.user?.id && a.user.id === b?.user?.id);
    } catch { return false; }
  };
  const keys = () => {
    for (const store of [persistent, temporary]) {
      try {
        for (let i = 0; i < (store?.length || 0); i++) {
          const key = store.key(i);
          if (key === storageKey || key?.startsWith(`${storageKey}-`)) knownKeys.add(key);
        }
      } catch { /* known SDK keys and memory still work */ }
    }
    return knownKeys;
  };

  return {
    getRememberMe: () => remember,
    acceptsSession(session) {
      const raw = memory.get(storageKey) ?? read(target(), storageKey);
      if (!session) return raw === null || raw === undefined;
      try { return JSON.parse(raw)?.access_token === session.access_token; } catch { return false; }
    },
    setRememberMe(value, { savePreference = true, migrateSession = true } = {}) {
      const nextRemember = Boolean(value);
      const previous = target();
      const changed = nextRemember !== remember;
      const records = changed && migrateSession
        ? [...keys()].map(key => [key, memory.get(key) ?? read(previous, key)])
        : !migrateSession && !nextRemember
          // Recovery must retain its PKCE proof from the initiating page,
          // including auth-js flow slots/index. Never copy the login session.
          ? [...keys()].filter(key => key.endsWith('-code-verifier'))
            .map(key => [key, memory.get(key) ?? read(temporary, key) ?? read(persistent, key)])
          : [];
      const migratingSession = memory.get(storageKey) ?? read(previous, storageKey);
      removingSession = null;
      remember = nextRemember;
      // Mode is per tab. A different tab changing its default preference must
      // not make this tab write a session-only token into persistent storage.
      write(temporary, modeKey, String(remember));
      if (savePreference) write(persistent, preferenceKey, String(remember));
      for (const [key, record] of records) {
        if (record !== null && record !== undefined) {
          if (write(target(), key, record)) memory.delete(key);
          else memory.set(key, record);
        }
        const previousValue = read(other(), key);
        if (previousValue === record || sameSessionOwner(migratingSession, read(other(), storageKey))) {
          remove(other(), key);
        }
      }
    },
    storage: {
      getItem(key) {
        knownKeys.add(key);
        return memory.get(key) ?? read(target(), key);
      },
      setItem(key, value) {
        removingSession = null;
        knownKeys.add(key);
        write(temporary, modeKey, String(remember));
        if (write(target(), key, value)) memory.delete(key);
        else memory.set(key, value);
        // Do not remove another tab's persistent login during a session-only
        // refresh. Explicit mode changes migrate/remove the previous location.
      },
      removeItem(key) {
        knownKeys.add(key);
        const currentValue = memory.get(key) ?? read(target(), key);
        const ownedSession = memory.get(storageKey) ?? read(target(), storageKey) ?? removingSession;
        const otherValue = read(other(), key);
        const ownsOther = (currentValue !== null && currentValue === otherValue)
          || sameSessionOwner(ownedSession, read(other(), storageKey));
        if (key === storageKey) removingSession = ownedSession;
        memory.delete(key);
        remove(target(), key);
        // Another account may be remembered in a different tab. A temporary
        // session can clear its own duplicate, never that account's tokens.
        if (ownsOther) remove(other(), key);
      }
    }
  };
}

function browserStorage(name) {
  try { return globalThis[name]; } catch { return undefined; }
}

export function createBrowserAuthStorage(projectUrl) {
  let project = 'coiny';
  try { project = new URL(projectUrl).hostname.split('.')[0]; } catch { /* demo builds */ }
  return createAuthStorageAdapter({
    storageKey: `sb-${project}-auth-token`,
    localStorage: browserStorage('localStorage'),
    sessionStorage: browserStorage('sessionStorage')
  });
}
