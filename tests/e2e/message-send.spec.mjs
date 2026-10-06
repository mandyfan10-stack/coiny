import { expect, test } from '@playwright/test';
import { enterMockApp } from './helpers.mjs';

test('empty Saved Messages finishes loading and shows an empty history', async ({ page }) => {
  await enterMockApp(page);
  await page.locator('.chat-item').filter({ hasText: 'Избранное' }).click();
  await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
  await expect(page.locator('.chat-skeleton-container')).toHaveCount(0);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.locator('.chat-item').filter({ hasText: 'Избранное' }).click();
  await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
});

test('mock group chat sends a message and clears its pending state', async ({ page }) => {
  const pageErrors = [];
  const marker = `E2E-MESSAGE-${Date.now()}`;
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await enterMockApp(page);
  await page.getByText('Coiny Community 👥', { exact: true }).click();

  const composer = page.locator('.chat-footer-input textarea').first();
  await composer.fill(marker);
  await page.locator('.send-message-btn[title="Отправить"]').click();

  const outgoing = page.locator('.message-row.row-me').filter({ hasText: marker }).last();
  await expect(outgoing).toBeVisible();
  await expect(outgoing.locator('.seen-check.pending')).toHaveCount(0);
  await expect(outgoing.locator('.seen-check.failed')).toHaveCount(0);
  await expect(composer).toHaveValue('');

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
