import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthStorageAdapter } from '../src/utils/authStorage.js';

const KEY = 'sb-synthetic-auth-token';
const token = id => JSON.stringify({ access_token: `access-${id}`, refresh_token: `refresh-${id}`, user: { id } });
function store(values = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; }
  };
}
const create = (localStorage, sessionStorage) => createAuthStorageAdapter({ storageKey: KEY, localStorage, sessionStorage });

test('existing remembered Supabase sessions remain readable without migration', () => {
  const local = store({ [KEY]: token('legacy') });
  const auth = create(local, store());
  assert.equal(auth.getRememberMe(), true);
  assert.equal(auth.storage.getItem(KEY), token('legacy'));
});

test('unchecked migrates session and PKCE keys out of localStorage before login/refresh', () => {
  const local = store({ [KEY]: token('alice'), [`${KEY}-code-verifier`]: 'verifier', unrelated: 'keep' });
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false);
  assert.equal(local.getItem(KEY), null);
  assert.equal(local.getItem(`${KEY}-code-verifier`), null);
  assert.equal(temporary.getItem(KEY), token('alice'));
  assert.equal(temporary.getItem(`${KEY}-code-verifier`), 'verifier');
  auth.storage.setItem(KEY, token('refreshed'));
  assert.equal(local.getItem(KEY), null);
  assert.equal(temporary.getItem(KEY), token('refreshed'));
  assert.equal(local.getItem('unrelated'), 'keep');
});

test('unchecked survives same-tab reload but not a new browser session', () => {
  const local = store();
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false);
  auth.storage.setItem(KEY, token('alice'));
  const reloaded = create(local, temporary);
  assert.equal(reloaded.getRememberMe(), false);
  assert.equal(reloaded.storage.getItem(KEY), token('alice'));
  const reopened = create(local, store());
  assert.equal(reopened.getRememberMe(), false);
  assert.equal(reopened.storage.getItem(KEY), null);
});

test('checking remember migrates session to persistent storage and survives closing the browser', () => {
  const local = store();
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false);
  auth.storage.setItem(KEY, token('alice'));
  auth.setRememberMe(true);
  assert.equal(temporary.getItem(KEY), null);
  assert.equal(local.getItem(KEY), token('alice'));
  assert.equal(create(local, store()).storage.getItem(KEY), token('alice'));
});

test('logout clears duplicate session tokens from both possible storage locations', () => {
  const local = store({ [KEY]: token('alice') });
  const temporary = store({ [KEY]: token('alice') });
  const auth = create(local, temporary);
  auth.storage.removeItem(KEY);
  assert.equal(local.getItem(KEY), null);
  assert.equal(temporary.getItem(KEY), null);
  assert.equal(auth.storage.getItem(KEY), null);
});

test('temporary account logout preserves another account remembered in a different tab', () => {
  const local = store();
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false);
  auth.storage.setItem(KEY, token('alice'));
  local.setItem(KEY, token('bob'));
  auth.storage.removeItem(KEY);
  assert.equal(temporary.getItem(KEY), null);
  assert.equal(local.getItem(KEY), token('bob'));
  assert.equal(auth.storage.getItem(KEY), null);
});

test('session-only tab refresh stays temporary despite another tab remembering its own login', () => {
  const local = store();
  const firstTemporary = store();
  const first = create(local, firstTemporary);
  first.setRememberMe(false);
  first.storage.setItem(KEY, token('first'));
  const second = create(local, store());
  second.setRememberMe(true);
  second.storage.setItem(KEY, token('second'));
  first.storage.setItem(KEY, token('first-refreshed'));
  assert.equal(firstTemporary.getItem(KEY), token('first-refreshed'));
  assert.equal(local.getItem(KEY), token('second'));
  assert.equal(create(local, firstTemporary).getRememberMe(), false);
  first.setRememberMe(false);
  assert.equal(local.getItem(KEY), token('second'));
  assert.equal(create(local, store()).storage.getItem(KEY), token('second'));
});

test('foreign cross-tab auth notifications do not change this tab session', () => {
  const local = store();
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false);
  auth.storage.setItem(KEY, token('alice'));
  assert.equal(auth.acceptsSession({ access_token: 'access-alice' }), true);
  assert.equal(auth.acceptsSession({ access_token: 'access-bob' }), false);
  assert.equal(auth.acceptsSession(null), false);
  auth.storage.removeItem(KEY);
  assert.equal(auth.acceptsSession(null), true);
});

test('recovery may force a temporary session without changing the next login preference', () => {
  const local = store();
  const auth = create(local, store());
  auth.setRememberMe(false, { savePreference: false });
  auth.storage.setItem(KEY, token('recovery'));
  assert.equal(local.getItem(KEY), null);
  assert.equal(create(local, store()).getRememberMe(), true);
});

test('opening an invalid recovery link leaves a remembered account untouched', () => {
  const local = store({ [KEY]: token('remembered-alice') });
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false, { savePreference: false, migrateSession: false });
  assert.equal(auth.storage.getItem(KEY), null);
  assert.equal(temporary.getItem(KEY), null);
  assert.equal(local.getItem(KEY), token('remembered-alice'));
  auth.storage.removeItem(KEY);
  assert.equal(local.getItem(KEY), token('remembered-alice'));
});

test('closing recovery for a different account preserves the remembered account', () => {
  const local = store({ [KEY]: token('remembered-alice') });
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false, { savePreference: false, migrateSession: false });
  auth.storage.setItem(KEY, token('recovery-bob'));
  assert.equal(local.getItem(KEY), token('remembered-alice'));
  auth.storage.removeItem(KEY);
  assert.equal(temporary.getItem(KEY), null);
  assert.equal(local.getItem(KEY), token('remembered-alice'));
});

test('isolated recovery keeps PKCE proofs available without migrating the remembered login', () => {
  const verifierKeys = [
    `${KEY}-code-verifier`,
    `${KEY}-flow-synthetic-flow-code-verifier`,
    `${KEY}-flows-code-verifier`
  ];
  const local = store({ [KEY]: token('remembered-alice'), [`${KEY}-user`]: 'remembered-user' });
  for (const key of verifierKeys) local.setItem(key, `proof:${key}`);
  const temporary = store();
  const auth = create(local, temporary);
  auth.setRememberMe(false, { savePreference: false, migrateSession: false });
  assert.equal(local.getItem(KEY), token('remembered-alice'));
  assert.equal(local.getItem(`${KEY}-user`), 'remembered-user');
  assert.equal(temporary.getItem(KEY), null);
  assert.equal(temporary.getItem(`${KEY}-user`), null);
  for (const key of verifierKeys) {
    assert.equal(auth.storage.getItem(key), `proof:${key}`);
    assert.equal(local.getItem(key), null);
    auth.storage.removeItem(key);
    assert.equal(temporary.getItem(key), null);
    assert.equal(local.getItem(key), null);
  }
  assert.equal(local.getItem(KEY), token('remembered-alice'));
});

test('unavailable browser storage falls back to memory without storing temporary tokens persistently', () => {
  const unavailable = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); }, removeItem() { throw new Error('Denied'); } };
  const local = store();
  const auth = create(local, unavailable);
  auth.setRememberMe(false);
  auth.storage.setItem(KEY, token('alice'));
  assert.equal(auth.storage.getItem(KEY), token('alice'));
  assert.equal(local.getItem(KEY), null);
  auth.storage.removeItem(KEY);
  assert.equal(auth.storage.getItem(KEY), null);
});
