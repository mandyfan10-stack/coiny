import { test, expect } from '@playwright/test';

const fixture = '/tests/ui/auth-login-fixture.html';
const user = { id: '00000000-0000-4000-8000-000000000023', email: 'audit@example.test', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {} };
const jwt = () => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.c3ludGhldGlj`;
async function routes(page, mode = 'success') {
  const requests = [];
  let profileError = mode === 'profile-error';
  await page.routeWebSocket(/.*/, () => {});
  await page.route('https://audit.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(data) });
    if (req.method() === 'OPTIONS') return json(200, {});
    const body = req.postDataJSON();
    requests.push({ path: url.pathname, query: url.search, body });
    if (url.pathname.endsWith('/token')) {
      if (mode === 'invalid' || mode.startsWith('username')) return json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (mode === 'rate') return json(429, { code: 'over_request_rate_limit', msg: 'Too many requests' });
      return json(200, { access_token: jwt(), refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer', user });
    }
    if (url.pathname.endsWith('/username-login')) {
      if (mode === 'username-invalid') return json(401, { error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
      if (mode === 'username-rate') return json(429, { error: { code: 'over_request_rate_limit' } });
      return json(200, { session: { access_token: jwt(), refresh_token: 'synthetic-refresh' } });
    }
    if (url.pathname.endsWith('/user')) return json(200, user);
    if (url.pathname.includes('/profiles')) {
      if (profileError) return json(500, { code: 'internal_error', message: 'Synthetic profile failure' });
      return json(200, { id: user.id, username: 'audit_user', display_name: 'Аудит', has_e2ee: false });
    }
    return json(200, {});
  });
  return { requests, restoreProfile: () => { profileError = false; } };
}
async function login(page, { identifier = user.email, remember = true } = {}) {
  await page.goto(fixture);
  await page.getByRole('checkbox', { name: 'Запомнить меня' }).setChecked(remember);
  await page.locator('#loginIdentifier').fill(identifier);
  await page.locator('#password').fill('Synthetic#Password23');
  await page.locator('button[type=submit]').click();
}
async function storageTokens(page) {
  return page.evaluate(() => ({
    local: Object.keys(localStorage).filter(key => /^sb-.*-auth-token$/.test(key)),
    session: Object.keys(sessionStorage).filter(key => /^sb-.*-auth-token$/.test(key)),
  }));
}

test('real SDK direct email login persists across reload and removes the saved session on logout', async ({ page }) => {
  const { requests } = await routes(page);
  await login(page);
  await expect(page.getByTestId('owner')).toHaveText(user.id);
  expect((await storageTokens(page)).local).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('owner')).toHaveText(user.id);
  expect(requests.filter(row => row.path.endsWith('/token'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.locator('#loginIdentifier')).toBeVisible();
  expect(await storageTokens(page)).toEqual({ local: [], session: [] });
  await page.reload();
  await expect(page.locator('#loginIdentifier')).toBeVisible();
});

for (const remember of [false, true]) {
  test(`remember=${remember} uses the selected storage and browser restart keeps only persistent login`, async ({ page, browser, baseURL }) => {
    await routes(page);
    await login(page, { remember });
    await expect(page.getByTestId('owner')).toHaveText(user.id);
    expect(await storageTokens(page)).toEqual(remember ? { local: ['sb-audit-auth-token'], session: [] } : { local: [], session: ['sb-audit-auth-token'] });
    expect(await page.evaluate(async () => {
      const { supabase } = await import('/src/supabaseClient.js');
      return Boolean((await supabase.auth.refreshSession()).error);
    })).toBe(false);
    expect(await storageTokens(page)).toEqual(remember ? { local: ['sb-audit-auth-token'], session: [] } : { local: [], session: ['sb-audit-auth-token'] });
    await page.reload();
    await expect(page.getByTestId('owner')).toHaveText(user.id);
    // A fresh context restores the browser's persistent state, without sessionStorage.
    const saved = await page.context().storageState();
    const nextContext = await browser.newContext({ baseURL, storageState: saved });
    try {
      const nextPage = await nextContext.newPage();
      await routes(nextPage);
      await nextPage.goto(fixture);
      if (remember) await expect(nextPage.getByTestId('owner')).toHaveText(user.id);
      else await expect(nextPage.locator('#loginIdentifier')).toBeVisible();
    } finally { await nextContext.close(); }
  });
}

test('unchecked login is private to its tab and leaves a fresh tab signed out', async ({ page, context }) => {
  await routes(page);
  const sibling = await context.newPage();
  try {
    await routes(sibling);
    await sibling.goto(fixture);
    await expect(sibling.locator('#loginIdentifier')).toBeVisible();
    await login(page, { remember: false });
    await expect(page.getByTestId('owner')).toHaveText(user.id);
    await page.evaluate(async () => {
      // Both tabs have consumed preceding broadcast work before assertions.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(sibling.locator('#loginIdentifier')).toBeVisible();
    await sibling.reload();
    await expect(sibling.locator('#loginIdentifier')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('owner')).toHaveText(user.id);
  } finally { await sibling.close(); }
});

test('real SDK username login uses the private password-checking endpoint after both internal addresses fail', async ({ page }) => {
  const { requests } = await routes(page, 'username-success');
  await login(page, { identifier: 'audit_user' });
  await expect(page.getByTestId('owner')).toHaveText(user.id);
  expect(requests.filter(row => row.path.endsWith('/token')).map(row => row.body.email)).toEqual(['audit_user@coiny.users.local', 'audit_user@tg-clone.com']);
  expect(requests.find(row => row.path.endsWith('/username-login')).body).toEqual({ username: 'audit_user', password: 'Synthetic#Password23' });
  expect(requests.some(row => row.path.includes('/rpc/resolve_username'))).toBe(false);
});

for (const mode of ['invalid', 'rate', 'username-invalid', 'username-rate']) {
  test(`real SDK ${mode} shows a clear error and does not establish a session`, async ({ page }) => {
    const { requests } = await routes(page, mode);
    await login(page, { identifier: mode.startsWith('username') ? 'audit_user' : user.email });
    await expect(page.locator('.auth-error-alert')).toContainText(mode.endsWith('rate') ? 'Слишком много' : 'Неверный');
    await expect(page.getByTestId('owner')).toHaveCount(0);
    expect(await storageTokens(page)).toEqual({ local: [], session: [] });
    if (!mode.startsWith('username')) expect(requests.filter(row => row.path.endsWith('/token'))).toHaveLength(1);
  });
}

test('real SDK accepted login with a profile error offers retry without exposing the wrong account', async ({ page }) => {
  const control = await routes(page, 'profile-error');
  await login(page);
  await expect(page.getByRole('heading', { name: 'Не удалось открыть аккаунт' })).toBeVisible();
  await expect(page.getByTestId('owner')).toHaveCount(0);
  control.restoreProfile();
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await expect(page.getByTestId('owner')).toHaveText(user.id);
  expect(control.requests.filter(row => row.path.endsWith('/token'))).toHaveLength(1);
});
