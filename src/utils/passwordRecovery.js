const RECOVERY_STORAGE_KEY = 'coiny_password_recovery';
const INVALID_LINK = 'Ссылка недействительна или истекла. Запросите новое письмо для восстановления.';

/** Keep the actual deployment path. Native clients recover in the web app. */
export function getPasswordRecoveryRedirectUrl(href = globalThis.location?.href) {
  let url;
  try { url = new URL(href); } catch { /* use the canonical web app below */ }
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    url = new URL('https://mandyfan10-stack.github.io/coiny/');
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set('auth', 'recovery');
  return url.href;
}

export function validateRecoveryPassword(password, confirmation = password) {
  if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password)
    || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Пароль: от 10 символов, строчная и заглавная латинские буквы, цифра и специальный символ.';
  }
  if (password !== confirmation) return 'Пароли не совпадают.';
  return '';
}

/** A recovery link opens a separate, fenced flow, never the messenger. */
export function createPasswordRecoveryController({ href, replaceUrl = () => {}, storage } = {}) {
  let payload = null;
  let resumeUserId = null;
  try { resumeUserId = storage?.getItem(RECOVERY_STORAGE_KEY) || null; } catch { /* private browsing */ }
  try {
    const url = new URL(href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const explicit = url.searchParams.get('auth') === 'recovery'
      || hash.get('type') === 'recovery' || url.hash === '#reset-password';
    if (explicit) {
      payload = {
        accessToken: hash.get('access_token'), refreshToken: hash.get('refresh_token'),
        code: url.searchParams.get('code'), invalid: hash.has('error') || url.searchParams.has('error'),
      };
      url.hash = '';
      for (const key of ['auth', 'code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
      // Remove credentials before any network call, React render or logging.
      replaceUrl(`${url.pathname}${url.search}`);
    }
  } catch { /* non-browser/unit-test initialization */ }
  if (payload) {
    try { storage?.setItem(RECOVERY_STORAGE_KEY, '__pending__'); } catch { /* memory gate still applies */ }
  }
  let snapshot = { status: payload || resumeUserId ? 'verifying' : 'idle', userId: null, error: '' };
  let initialization;
  let saving = false;
  let sessionGeneration = 0;
  let controlledSignOut = false;
  let subscription;
  let createScopedAuth;
  const listeners = new Set();
  const publish = (next) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const storeUser = (userId) => {
    try {
      if (userId) storage?.setItem(RECOVERY_STORAGE_KEY, userId);
      else storage?.removeItem(RECOVERY_STORAGE_KEY);
    } catch { /* state remains fenced in memory */ }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    initialize(auth, scopedAuthFactory) {
      createScopedAuth ||= scopedAuthFactory;
      if (initialization) return initialization;
      if (snapshot.status === 'idle') return Promise.resolve();
      initialization = (async () => {
        try {
          if (!auth || payload?.invalid) throw new Error(INVALID_LINK);
          subscription = auth.onAuthStateChange?.((event, session) => {
            if (controlledSignOut || !resumeUserId || ['idle', 'complete'].includes(snapshot.status)) return;
            if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== resumeUserId)) {
              sessionGeneration += 1;
              publish({ status: 'error', userId: null, error: INVALID_LINK });
            }
          })?.data?.subscription;
          if (payload) {
            let result;
            if (payload.accessToken && payload.refreshToken) {
              result = await auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
            } else if (payload.code) {
              result = await auth.exchangeCodeForSession(payload.code);
            } else throw new Error(INVALID_LINK);
            if (result.error || !result.data?.session?.user?.id) throw new Error(INVALID_LINK);
            resumeUserId = result.data.session.user.id;
          }
          const generation = sessionGeneration;
          const checked = await auth.getUser();
          if (generation !== sessionGeneration || checked.error || !checked.data?.user?.id || checked.data.user.id !== resumeUserId) throw new Error(INVALID_LINK);
          storeUser(resumeUserId);
          publish({ status: 'ready', userId: resumeUserId, error: '' });
        } catch {
          publish({ status: 'error', userId: null, error: INVALID_LINK });
        } finally { payload = null; }
      })();
      return initialization;
    },
    async update(auth, password) {
      const validation = validateRecoveryPassword(password);
      if (validation) return { error: new Error(validation) };
      if (snapshot.status !== 'ready' || saving) return { error: new Error(INVALID_LINK) };
      saving = true;
      const recoveryUserId = snapshot.userId;
      const generation = sessionGeneration;
      let scopedAuth;
      try {
        const checked = await auth.getUser();
        if (generation !== sessionGeneration || snapshot.status !== 'ready' || checked.error || checked.data?.user?.id !== recoveryUserId) {
          publish({ status: 'error', userId: null, error: INVALID_LINK });
          return { error: new Error(INVALID_LINK) };
        }
        // updateUser reads its client's current session under a separate lock.
        // Bind the write to an isolated client so a replacement account can
        // never become the target between validation and the actual request.
        const current = await auth.getSession();
        if (current.error || current.data?.session?.user?.id !== recoveryUserId
          || generation !== sessionGeneration || snapshot.status !== 'ready' || !createScopedAuth) {
          return { error: new Error(INVALID_LINK) };
        }
        scopedAuth = createScopedAuth();
        const bound = await scopedAuth.setSession({
          access_token: current.data.session.access_token,
          refresh_token: current.data.session.refresh_token,
        });
        if (bound.error || bound.data?.session?.user?.id !== recoveryUserId
          || generation !== sessionGeneration || snapshot.status !== 'ready') return { error: new Error(INVALID_LINK) };
        const result = await scopedAuth.updateUser({ password });
        if (generation !== sessionGeneration || snapshot.status !== 'ready') return { error: new Error(INVALID_LINK) };
        if (result.error) return { error: new Error('Не удалось изменить пароль. Проверьте требования к паролю и повторите попытку.') };
        if (result.data?.user?.id !== recoveryUserId) throw new Error(INVALID_LINK);
        const afterUpdate = await auth.getSession();
        if (afterUpdate.error || afterUpdate.data?.session?.user?.id !== recoveryUserId
          || generation !== sessionGeneration || snapshot.status !== 'ready') return { error: new Error(INVALID_LINK) };
        controlledSignOut = true;
        const signedOut = await auth.signOut({ scope: 'local' });
        controlledSignOut = false;
        if (signedOut?.error) return { error: new Error('Пароль изменён. Не удалось завершить сеанс: нажмите «Вернуться ко входу».') };
        storeUser(null);
        subscription?.unsubscribe();
        publish({ status: 'complete', userId: null, error: '' });
        return { data: { ok: true } };
      } catch { return { error: new Error('Не удалось изменить пароль. Проверьте соединение и повторите попытку.') }; }
      finally {
        try { await scopedAuth?.dispose?.(); } catch { /* remove only isolated-client listeners */ }
        saving = false;
        controlledSignOut = false;
      }
    },
    async close(auth) {
      if (snapshot.status === 'verifying' || saving) return { error: new Error('Дождитесь завершения проверки.') };
      try {
        const generation = sessionGeneration;
        const current = await auth?.getSession();
        if (current?.error) throw current.error;
        // Returning from an expired flow must not log out a replacement
        // account that signed in while the recovery form was open.
        if (resumeUserId && current?.data?.session?.user?.id === resumeUserId
          && generation === sessionGeneration) {
          controlledSignOut = true;
          const result = await auth.signOut({ scope: 'local' });
          controlledSignOut = false;
          if (result?.error) throw result.error;
        }
        storeUser(null);
        subscription?.unsubscribe();
        publish({ status: 'idle', userId: null, error: '' });
        return { data: { ok: true } };
      } catch { return { error: new Error('Не удалось завершить сеанс. Проверьте соединение и повторите попытку.') }; }
      finally { controlledSignOut = false; }
    },
  };
}

let browserStorage;
try { browserStorage = globalThis.sessionStorage; } catch { /* storage can be disabled */ }
const recovery = createPasswordRecoveryController({
  href: globalThis.location?.href,
  storage: browserStorage,
  replaceUrl: (url) => globalThis.history?.replaceState(globalThis.history.state, '', url),
});
export const getPasswordRecoverySnapshot = recovery.getSnapshot;
export const subscribePasswordRecovery = recovery.subscribe;
export const initializePasswordRecovery = (auth, createScopedAuth) => recovery.initialize(auth, createScopedAuth);
export const updateRecoveredPassword = (auth, password) => recovery.update(auth, password);
export const closePasswordRecovery = (auth) => recovery.close(auth);
