import { test, expect } from '@playwright/test';
const fixture = '/tests/ui/password-recovery-fixture.html';
const user = { id: '00000000-0000-4000-8000-000000000023', email: 'recovery@example.test', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {} };
const jwt = () => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.c3ludGhldGlj`;
async function routes(page, { expired = false, failUpdate = false } = {}) {
  const requests = [];
  await page.routeWebSocket(/.*/, () => {});
  await page.route(/https?:\/\/[^/]+\/(?:auth\/v1|rest\/v1)\/.*/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return reply(200, {});
    requests.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() });
    if (url.pathname.endsWith('/user') && req.method() === 'GET') return expired ? reply(401, { code: 'bad_jwt', msg: 'expired' }) : reply(200, user);
    if (url.pathname.endsWith('/user') && req.method() === 'PUT') {
      const count = requests.filter(row => row.method === 'PUT').length;
      return failUpdate && count === 1 ? reply(422, { code: 'weak_password', msg: 'Use a different password' }) : reply(200, user);
    }
    if (url.pathname.endsWith('/token')) return reply(200, { access_token: jwt(), refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer', user });
    if (url.pathname.includes('/profiles')) return reply(200, { id: user.id, username: 'recovery_user', display_name: 'Аудит', has_e2ee: false });
    return reply(200, {});
  });
  return requests;
}
const link = () => `${fixture}?auth=recovery#access_token=${jwt()}&refresh_token=synthetic-refresh&type=recovery`;
async function fillPassword(page, confirmation = 'New-password23!') {
  await page.locator('#recovery-password').fill('New-password23!');
  await page.getByLabel('Повторите пароль').fill(confirmation);
  await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
}
test('real SDK recovery validates link, survives reload and saves a new password without showing private account', async ({ page }) => {
  const requests = await routes(page);
  await page.goto(link());
  await expect(page.locator('#recovery-password')).toBeFocused();
  expect(page.url()).not.toMatch(/access_token|refresh_token|auth=recovery/);
  await page.reload();
  await expect(page.locator('#recovery-password')).toBeVisible();
  await fillPassword(page);
  await expect(page.getByRole('heading', { name: 'Пароль изменён', exact: true })).toBeVisible();
  expect(requests.filter(row => row.method === 'PUT').map(row => row.body)).toEqual([expect.objectContaining({ password: 'New-password23!' })]);
  expect(requests.some(row => row.path.includes('/profiles'))).toBe(false);
  await expect(page.getByTestId('private-account')).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуться ко входу' }).click();
  await expect(page.locator('#loginIdentifier')).toBeVisible();
  await page.reload();
  await expect(page.locator('#loginIdentifier')).toBeVisible();
});
test('recovery rejects mismatched confirmation and retains passwords on a server error for retry', async ({ page }) => {
  const requests = await routes(page, { failUpdate: true });
  await page.goto(link());
  await fillPassword(page, 'Different23!');
  await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают.');
  expect(requests.filter(row => row.method === 'PUT')).toHaveLength(0);
  await page.getByLabel('Повторите пароль').fill('New-password23!');
  await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось изменить пароль');
  await expect(page.locator('#recovery-password')).toHaveValue('New-password23!');
  await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пароль изменён', exact: true })).toBeVisible();
});
for (const kind of ['expired', 'error', 'missing']) {
  test(`recovery ${kind} never exposes a saved private account or a password update form`, async ({ page }) => {
    const requests = await routes(page, { expired: kind === 'expired' });
    const href = kind === 'expired' ? link() : `${fixture}?auth=recovery${kind === 'error' ? '#error=access_denied&error_description=private-description' : ''}`;
    await page.goto(href);
    await expect(page.getByRole('alert')).toContainText('Ссылка недействительна или истекла');
    await expect(page.locator('#recovery-password')).toHaveCount(0);
    await expect(page.getByTestId('private-account')).toHaveCount(0);
    expect(page.url()).not.toMatch(/access_token|error_description|auth=recovery/);
    expect(requests.some(row => row.path.includes('/profiles'))).toBe(false);
    await page.getByRole('button', { name: 'Вернуться ко входу' }).click();
    await expect(page.locator('#loginIdentifier')).toBeVisible();
  });
}
test('real SDK exchanges a marked PKCE recovery callback', async ({ page }) => {
  const requests = await routes(page);
  await page.addInitScript(() => { localStorage.setItem('sb-audit-auth-token-code-verifier', JSON.stringify('synthetic-verifier/recovery')); });
  await page.goto(`${fixture}?auth=recovery&code=synthetic-code`);
  await expect(page.locator('#recovery-password')).toBeVisible();
  expect(page.url()).not.toMatch(/code=|auth=recovery/);
  const exchange = requests.find(row => row.path.endsWith('/token'));
  expect(exchange.body).toEqual({ auth_code: 'synthetic-code', code_verifier: 'synthetic-verifier' });
  expect(requests.some(row => row.path.includes('/profiles'))).toBe(false);
});
test('reset request keeps the deployed application path and an explicit recovery marker', async ({ page }) => {
  const requests = await routes(page);
  await page.route(/https?:\/\/[^/]+\/auth\/v1\/recover.*/, async route => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname, redirect: url.searchParams.get('redirect_to') });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Забыли пароль?' }).click();
  await page.locator('#resetIdentifier').fill(user.email);
  await page.locator('button[type="submit"]').click();
  const expected = new URL(fixture, page.url());
  expected.searchParams.set('auth', 'recovery');
  await expect.poll(() => requests.find(row => row.path.endsWith('/recover'))?.redirect).toBe(expected.href);
});
