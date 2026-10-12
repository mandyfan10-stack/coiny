import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

async function ready(page, query = '') {
  await page.goto('/tests/ui/interface-fixture.html' + query);
  await expect.poll(() => page.evaluate(() => Boolean(window.__interfaceTest))).toBe(true);
}

const back = page => page.evaluate(() => window.handleAndroidBackButton());

test('mobile search does not retain a previous account filter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '?list');
  await page.getByRole('button', { name: 'Поиск чатов', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Поиск чатов и сообщений' }).fill('Анна');
  await page.evaluate(() => window.__interfaceTest.setUser(user => ({ ...user, id: 'another-account' })));
  await expect(page.locator('.sidebar-search input')).toBeHidden();
  await expect(page.locator('.sidebar-search input')).toHaveValue('');
  await expect(page.locator('[data-chat-id="design"]')).toBeVisible();
  expect(await back(page)).toBe(false);
});

test('Android Back closes mobile list search and restores the full list and focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '?list');
  const trigger = page.getByRole('button', { name: 'Поиск чатов', exact: true });
  const search = page.getByRole('searchbox', { name: 'Поиск чатов и сообщений' });
  await trigger.click();
  await search.fill('Анна');
  await expect(page.locator('[data-chat-id="design"]')).toHaveCount(0);
  expect(await back(page)).toBe(true);
  await expect(search).toBeHidden();
  await expect(page.locator('.sidebar-search input')).toHaveValue('');
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-chat-id="design"]')).toBeVisible();
  expect(await back(page)).toBe(false);
});

test('Back from a search result returns to search before closing it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '?list');
  await page.getByRole('button', { name: 'Поиск чатов', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Поиск чатов и сообщений' });
  await search.fill('Дизайн');
  await page.locator('[data-chat-id="design"]').press('Enter');
  await expect(page.locator('.chat-header-title')).toHaveText('Дизайн приложения');
  expect(await back(page)).toBe(true);
  await expect(search).toBeVisible();
  await expect(search).toHaveValue('Дизайн');
  await expect(search).toBeFocused();
  expect(await back(page)).toBe(true);
  await expect(search).toBeHidden();
});

test('Back closes the media viewer before the chat or its info pane', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.locator('[data-message-id="photo"] .bubble-media-open').click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр изображения' });
  await expect(viewer).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.chat-header-title')).toHaveText('Дизайн приложения');

  await page.getByRole('button', { name: 'Информация', exact: true }).click();
  await page.getByRole('button', { name: 'Вложение 1', exact: true }).click();
  await expect(viewer).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.chat-info.open')).toBeVisible();
  expect(await back(page)).toBe(true);
  await expect(page.locator('.chat-info.open')).toHaveCount(0);
  await expect(page.locator('.chat-header-title')).toHaveText('Дизайн приложения');
});

test('photo viewer traps both Tab directions and returns focus without closing the chat', async ({ page }) => {
  await ready(page);
  const trigger = page.locator('[data-message-id="photo"] .bubble-media-open');
  await trigger.focus();
  await trigger.press('Enter');
  const close = page.getByRole('button', { name: 'Закрыть просмотр' });
  await expect(close).toBeFocused();
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect(close).toBeFocused();
  }
  // Programmatic focus also cannot reach the interface underneath the modal.
  await page.locator('.chat-header [aria-label="Поиск в чате"]').focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.chat-image-viewer')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('.chat-header-title')).toHaveText('Дизайн приложения');
});

test('closed info cannot receive Tab or programmatic focus and becomes accessible when open', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await ready(page);
  const info = page.locator('.chat-info');
  await page.getByRole('button', { name: 'Голосовое сообщение', exact: true }).focus();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('.chat-info')))).toBe(false);
  }
  await info.locator('.info-icon-btn').first().evaluate(node => node.focus());
  expect(await page.evaluate(() => Boolean(document.activeElement.closest('.chat-info')))).toBe(false);
  await page.getByRole('button', { name: 'Информация', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Закрыть информацию' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть информацию' }).focus();
  await expect(page.getByRole('button', { name: 'Закрыть информацию' })).toBeFocused();
});
