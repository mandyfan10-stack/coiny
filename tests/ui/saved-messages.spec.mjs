import { test, expect } from '@playwright/test';
const fixture = '/tests/ui/saved-messages-fixture.html';
const saved = page => page.getByRole('button', { name: 'Избранное', exact: true });
async function open(page, suffix = '') {
  await page.route('https://audit.supabase.co/**', route => route.abort());
  await page.goto(fixture + suffix);
  await expect(page.getByTestId('loaded')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
}
test('opens existing verified notes without a creation request', async ({ page }) => {
  await open(page, '?existing');
  await saved(page).click();
  await expect(page.getByTestId('active-chat')).toHaveText('saved-self');
  await expect(page.locator('.drawer-overlay')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => window.__saved.rpcCalls)).toBe(0);
});
test('creates and loads notes before navigation; blocks repeated clicks', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__saved.holdRpc = true; });
  await saved(page).click();
  await expect(page.getByRole('button', { name: 'Открытие…' })).toBeDisabled();
  await expect(page.getByTestId('active-chat')).toHaveText('none');
  await page.evaluate(() => window.__saved.releaseRpc());
  await expect(page.getByTestId('active-chat')).toHaveText('saved-self');
  expect(await page.evaluate(() => window.__saved.rpcCalls)).toBe(1);
});
for (const failure of ['failRpc', 'failFetch', 'noId', 'untrusted']) {
  test(`keeps menu open and allows retry after ${failure}`, async ({ page }) => {
    await open(page);
    await page.evaluate(failure => { window.__saved[failure] = true; }, failure);
    await saved(page).click();
    await expect(page.getByRole('alert')).toContainText('Не удалось открыть Избранное');
    await expect(page.locator('.drawer-overlay')).toHaveClass(/open/);
    await expect(page.getByTestId('active-chat')).toHaveText('none');
    await expect(saved(page)).toBeEnabled();
    await page.evaluate(failure => { window.__saved[failure] = false; }, failure);
    await saved(page).click();
    await expect(page.getByTestId('active-chat')).toHaveText('saved-self');
  });
}
test('creating notes for forwarding preserves the current chat and draft', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { chat } = window.__saved;
    chat.setActiveChatId('source');
    chat.updateDraft('source', { text: 'Черновик' });
    return await chat.openSavedMessages({ activate: false });
  });
  expect(result.id).toBe('saved-self');
  await expect(page.getByTestId('active-chat')).toHaveText('source');
  expect(await page.evaluate(() => window.__saved.chat.drafts.source.text)).toBe('Черновик');
});
for (const phase of ['Rpc', 'Fetch']) {
  test(`late ${phase} does not navigate after switching accounts`, async ({ page }) => {
    await open(page);
    await page.evaluate(phase => { window.__saved[`hold${phase}`] = true; }, phase);
    await saved(page).click();
    await expect.poll(() => page.evaluate(phase => typeof window.__saved[`release${phase}`], phase)).toBe('function');
    await page.evaluate(() => { window.__saved.setUser({ id: 'other', name: 'Другой' }); });
    await expect.poll(() => page.evaluate(() => window.__saved.owner)).toBe('other');
    await page.evaluate(phase => { window.__saved[`hold${phase}`] = false; window.__saved[`release${phase}`](); }, phase);
    await expect(page.getByTestId('active-chat')).toHaveText('none');
    await expect.poll(() => page.evaluate(() => window.__saved.chat.chats.some(c => c.id === 'saved-self'))).toBe(false);
  });
}
