import { test, expect } from '@playwright/test';
const fixture = '/tests/ui/invite-navigation-fixture.html';
async function ready(page, query = '') {
  await page.route('https://audit.supabase.co/**', route => route.abort());
  await page.goto(fixture + query);
  await expect.poll(() => page.evaluate(() => Boolean(window.__invite?.auth))).toBe(true);
}
const open = (page, target) => page.evaluate(target => window.__invite.open(target), target);
test('a user URL opens the personal chat, not a group containing that user', async ({ page }) => {
  await ready(page, '?invite=pasha_gug');
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-pasha_gug');
  expect(await page.evaluate(() => window.__invite.pending())).toBeNull();
  expect(new URL(page.url()).searchParams.has('invite')).toBe(false);
});
test('a pending user link survives login and resolves after the authenticated profile loads', async ({ page }) => {
  await ready(page, '?signedOut&invite=pasha_gug');
  await expect(page.getByTestId('owner')).toHaveText('signed-out');
  expect(await page.evaluate(() => window.__invite.pending())).toBe('pasha_gug');
  expect(await page.evaluate(() => window.__invite.requests.length)).toBe(0);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-pasha_gug');
});
test('missing API keeps the link and exposes a retry instead of silently discarding it', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('loaded')).not.toHaveText('0');
  await page.evaluate(() => { window.__invite.rpcError = 'PGRST202'; });
  await open(page, 'pasha_gug');
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть чат по ссылке');
  expect(await page.evaluate(() => window.__invite.pending())).toBe('pasha_gug');
  expect(await page.evaluate(() => window.__invite.requests.length)).toBe(1);
  await page.evaluate(() => { window.__invite.rpcError = null; });
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-pasha_gug');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('failed hydration never activates an unloaded chat, and retry reuses the created conversation', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('loaded')).not.toHaveText('0');
  await page.evaluate(() => { window.__invite.failRefresh = true; });
  await open(page, 'pasha_gug');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('active-chat')).toHaveText('none');
  await page.evaluate(() => { window.__invite.failRefresh = false; });
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-pasha_gug');
  expect(await page.evaluate(() => window.__invite.chats.get('viewer').filter(c => c.id === 'chat-viewer-pasha_gug').length)).toBe(1);
});
test('an invalid link can be dismissed without blocking later links', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('loaded')).not.toHaveText('0');
  await page.evaluate(() => { window.__invite.rpcError = 'P0002'; });
  await open(page, 'missing-user');
  await expect(page.getByRole('alert')).toContainText('не найден');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  expect(await page.evaluate(() => window.__invite.pending())).toBeNull();
  await page.evaluate(() => { window.__invite.rpcError = null; });
  await open(page, 'pasha_gug');
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-pasha_gug');
});
test('self links open Saved Messages and the same link can be opened again', async ({ page }) => {
  await ready(page, '?invite=viewer');
  await expect(page.getByTestId('active-chat')).toHaveText('saved-viewer');
  await page.evaluate(() => window.__invite.chat.setActiveChatId(null));
  await open(page, 'viewer');
  await expect(page.getByTestId('active-chat')).toHaveText('saved-viewer');
});
test('a newer link wins over a delayed earlier response', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('loaded')).not.toHaveText('0');
  await page.evaluate(() => { window.__invite.holdRpc = true; });
  await open(page, 'first'); await open(page, 'second');
  await expect.poll(() => page.evaluate(() => window.__invite.requests.length)).toBe(2);
  await page.evaluate(() => window.__invite.requests[1].resolve());
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-second');
  await page.evaluate(() => window.__invite.requests[0].resolve());
  await expect.poll(() => page.evaluate(() => window.__invite.chat.chats.some(c => c.id === 'chat-viewer-first'))).toBe(true);
  await expect(page.getByTestId('active-chat')).toHaveText('chat-viewer-second');
});
test('a delayed invite cannot navigate or clear the pending link of another account', async ({ page }) => {
  await ready(page);
  await expect(page.getByTestId('loaded')).not.toHaveText('0');
  await page.evaluate(() => { window.__invite.holdRpc = true; });
  await open(page, 'pasha_gug');
  await expect.poll(() => page.evaluate(() => window.__invite.requests.length)).toBe(1);
  await page.evaluate(() => window.__invite.auth.signInWithIdentifier('other', 'test-password'));
  await expect(page.getByTestId('owner')).toHaveText('other');
  await expect.poll(() => page.evaluate(() => window.__invite.requests.length)).toBe(2);
  await page.evaluate(() => window.__invite.requests[0].resolve());
  await expect(page.getByTestId('active-chat')).toHaveText('none');
  expect(await page.evaluate(() => window.__invite.pending())).toBe('pasha_gug');
  await page.evaluate(() => window.__invite.requests[1].resolve());
  await expect(page.getByTestId('active-chat')).toHaveText('chat-other-pasha_gug');
  expect(await page.evaluate(() => window.__invite.history.includes('chat-viewer-pasha_gug'))).toBe(false);
});
