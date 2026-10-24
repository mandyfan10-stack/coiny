import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordRecoveryController, getPasswordRecoveryRedirectUrl, validateRecoveryPassword } from '../src/utils/passwordRecovery.js';
const session = { user: { id: 'recovered-owner' }, access_token: 'recovery-access', refresh_token: 'recovery-refresh' };
const password = 'A-new-password1!';
function setup(href, overrides = {}, values = new Map()) {
  const calls = [];
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const recovery = createPasswordRecoveryController({ href, storage, replaceUrl: url => calls.push(['url', url]) });
  const auth = {
    setSession: async input => { calls.push(['setSession', input]); return { data: { session } }; },
    exchangeCodeForSession: async code => { calls.push(['code', code]); return { data: { session } }; },
    getUser: async () => ({ data: { user: session.user } }),
    getSession: async () => ({ data: { session } }),
    updateUser: async input => { calls.push(['updateUser', input]); return { data: { user: session.user } }; },
    signOut: async input => { calls.push(['signOut', input]); return {}; }, ...overrides,
  };
  const initialize = recovery.initialize;
  recovery.initialize = (input, factory) => initialize(input, factory || (() => ({
    setSession: async () => ({ data: { session } }),
    updateUser: (...args) => auth.updateUser(...args),
  })));
  return { recovery, auth, calls, values };
}
test('recovery redirect preserves deployment paths and supports native apps via web', () => {
  assert.equal(getPasswordRecoveryRedirectUrl('https://example.org/coiny/?invite=someone#chat'), 'https://example.org/coiny/?auth=recovery');
  assert.equal(getPasswordRecoveryRedirectUrl('http://localhost:1234/index.html'), 'http://localhost:1234/index.html?auth=recovery');
  assert.equal(getPasswordRecoveryRedirectUrl('file:///opt/Coiny/index.html'), 'https://mandyfan10-stack.github.io/coiny/?auth=recovery');
  assert.equal(getPasswordRecoveryRedirectUrl('capacitor://localhost/'), 'https://mandyfan10-stack.github.io/coiny/?auth=recovery');
});
test('implicit recovery removes tokens synchronously and checks user before allowing update', async () => {
  const { recovery, auth, calls, values } = setup('https://example.org/coiny/?auth=recovery#access_token=secret-a&refresh_token=secret-r&type=recovery');
  assert.equal(recovery.getSnapshot().status, 'verifying');
  assert.deepEqual(calls, [['url', '/coiny/']]);
  assert.equal(await recovery.update(auth, password).then(row => Boolean(row.error)), true);
  const initialization = recovery.initialize(auth);
  assert.equal(recovery.initialize(auth), initialization);
  await initialization;
  assert.equal(recovery.getSnapshot().status, 'ready');
  assert.equal(recovery.getSnapshot().userId, session.user.id);
  assert.equal(values.get('coiny_password_recovery'), session.user.id);
  assert.deepEqual(await recovery.update(auth, password), { data: { ok: true } });
  assert.equal(recovery.getSnapshot().status, 'complete');
  assert.equal(values.size, 0);
  assert.deepEqual(calls.slice(-2), [['updateUser', { password }], ['signOut', { scope: 'local' }]]);
});
test('PKCE recovery uses SDK exchange and strips code without consuming ordinary callback URLs', async () => {
  const { recovery, auth, calls } = setup('https://example.org/coiny/?auth=recovery&code=single-use-code');
  await recovery.initialize(auth);
  assert.equal(recovery.getSnapshot().status, 'ready');
  assert.deepEqual(calls, [['url', '/coiny/'], ['code', 'single-use-code']]);
  const ordinary = setup('https://example.org/coiny/?code=oauth-code#access_token=ordinary');
  await ordinary.recovery.initialize(ordinary.auth);
  assert.equal(ordinary.recovery.getSnapshot().status, 'idle');
  assert.deepEqual(ordinary.calls, []);
});
for (const hash of ['#access_token=expired&refresh_token=expired&type=recovery', '#error=access_denied&error_description=SECRET', '#reset-password', '']) {
  test(`invalid recovery is fenced: ${hash.split('=')[0] || 'missing tokens'}`, async () => {
    const { recovery, auth, calls } = setup(`https://example.org/coiny/?auth=recovery${hash}`, {
      setSession: async () => ({ error: new Error('SECRET') }),
    });
    await recovery.initialize(auth);
    assert.equal(recovery.getSnapshot().status, 'error');
    assert.doesNotMatch(recovery.getSnapshot().error, /SECRET/);
    assert.equal(Boolean((await recovery.update(auth, password)).error), true);
    assert.equal(calls.some(row => row[0] === 'updateUser'), false);
    await recovery.close(auth);
    assert.equal(recovery.getSnapshot().status, 'idle');
  });
}
test('checked recovery survives reload without storing credentials and account mismatch cannot change a password', async () => {
  const values = new Map();
  const first = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery', {}, values);
  await first.recovery.initialize(first.auth);
  const resumed = setup('https://example.org/coiny/', {}, values);
  assert.equal(resumed.recovery.getSnapshot().status, 'verifying');
  await resumed.recovery.initialize(resumed.auth);
  assert.equal(resumed.recovery.getSnapshot().status, 'ready');
  resumed.auth.getUser = async () => ({ data: { user: { id: 'another-account' } } });
  assert.equal(Boolean((await resumed.recovery.update(resumed.auth, password)).error), true);
  assert.equal(resumed.recovery.getSnapshot().status, 'error');
  assert.equal(resumed.calls.some(row => row[0] === 'updateUser'), false);
});
test('failed verification cannot reload into the messenger using a partially accepted session', async () => {
  const first = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery', { getUser: async () => { throw new Error('network'); } });
  await first.recovery.initialize(first.auth);
  const resumed = setup('https://example.org/coiny/', {}, first.values);
  await resumed.recovery.initialize(resumed.auth);
  assert.equal(resumed.recovery.getSnapshot().status, 'error');
});
test('update errors retain the verified flow for retry; concurrent submissions do not duplicate requests', async () => {
  const { recovery, auth, calls } = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery');
  await recovery.initialize(auth);
  auth.updateUser = async () => ({ error: new Error('sensitive error') });
  const failed = await recovery.update(auth, password);
  assert.doesNotMatch(failed.error.message, /sensitive/);
  assert.equal(recovery.getSnapshot().status, 'ready');
  let confirm;
  auth.updateUser = () => new Promise(resolve => { confirm = () => resolve({ data: { user: session.user } }); });
  const pending = recovery.update(auth, password);
  while (!confirm) await Promise.resolve();
  assert.equal(Boolean((await recovery.update(auth, password)).error), true);
  confirm();
  await pending;
  assert.equal(calls.filter(row => row[0] === 'signOut').length, 1);
});
test('password rules match registration, including confirmation', () => {
  assert.equal(validateRecoveryPassword(password, password), '');
  for (const value of ['short', 'lowercase-only12!', 'UPPERCASE-ONLY12!', 'NoDigitsHere!', 'NoSpecialChar12']) assert.ok(validateRecoveryPassword(value));
  assert.equal(validateRecoveryPassword(password, 'different'), 'Пароли не совпадают.');
});
for (const event of ['SIGNED_OUT', 'SIGNED_IN']) {
  test(`a late checked user cannot update a password after ${event} replaces the recovery session`, async () => {
    let listener;
    const { recovery, auth, calls } = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery', {
      onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    });
    await recovery.initialize(auth);
    let resolveCheckedUser;
    auth.getUser = () => new Promise(resolve => { resolveCheckedUser = resolve; });
    const pending = recovery.update(auth, password);
    listener(event, event === 'SIGNED_IN' ? { user: { id: 'another-owner' } } : null);
    resolveCheckedUser({ data: { user: session.user } });
    assert.equal(Boolean((await pending).error), true);
    assert.equal(recovery.getSnapshot().status, 'error');
    assert.equal(calls.some(row => ['updateUser', 'signOut'].includes(row[0])), false);
  });
}
test('a password update response arriving after replacement does not sign out the new account', async () => {
  let listener;
  const { recovery, auth, calls } = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery', {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
  });
  await recovery.initialize(auth);
  let resolveUpdate;
  auth.updateUser = () => new Promise(resolve => { resolveUpdate = resolve; });
  const pending = recovery.update(auth, password);
  while (!resolveUpdate) await Promise.resolve();
  listener('SIGNED_IN', { user: { id: 'another-owner' } });
  resolveUpdate({ data: { user: session.user } });
  assert.equal(Boolean((await pending).error), true);
  assert.equal(recovery.getSnapshot().status, 'error');
  assert.equal(calls.some(row => row[0] === 'signOut'), false);
});
test('password write remains bound to the recovered token if main session changes between client locks', async () => {
  const { recovery, auth } = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery');
  let scopedSession;
  let mainOwner = session.user.id;
  let writeOwner;
  auth.updateUser = async () => { throw new Error('must never update the main client'); };
  await recovery.initialize(auth, () => ({
    setSession: async tokens => {
      assert.equal(tokens.access_token, session.access_token);
      scopedSession = session;
      // Simulate another login immediately after the original client's lock
      // was released, before updateUser obtains its own client lock.
      mainOwner = 'another-account';
      return { data: { session: scopedSession } };
    },
    updateUser: async () => { writeOwner = scopedSession.user.id; return { data: { user: scopedSession.user } }; },
  }));
  auth.getSession = async () => ({ data: { session: { ...session, user: { id: mainOwner } } } });
  const result = await recovery.update(auth, password);
  assert.equal(writeOwner, 'recovered-owner');
  assert.notEqual(writeOwner, 'another-account');
  // Do not sign out the replacement account or report a completed recovery
  // after the user has left the original session.
  assert.ok(result.error);
});
test('closing an invalidated recovery never signs out a replacement account', async () => {
  const { recovery, auth, calls } = setup('https://example.org/coiny/#access_token=a&refresh_token=r&type=recovery');
  await recovery.initialize(auth);
  auth.getSession = async () => ({ data: { session: { ...session, user: { id: 'another-owner' } } } });
  await recovery.close(auth);
  assert.equal(recovery.getSnapshot().status, 'idle');
  assert.equal(calls.some(row => row[0] === 'signOut'), false);
});
test('closing an invalid link without a recovery session preserves a remembered account', async () => {
  const { recovery, auth, calls } = setup('https://example.org/coiny/?auth=recovery');
  await recovery.initialize(auth);
  await recovery.close(auth);
  assert.equal(recovery.getSnapshot().status, 'idle');
  assert.equal(calls.some(row => row[0] === 'signOut'), false);
});
