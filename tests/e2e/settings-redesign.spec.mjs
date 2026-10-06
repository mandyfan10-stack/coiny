import { test, expect } from '@playwright/test';
import { enterMockApp } from './helpers.mjs';

async function openSettings(page) {
  await page.locator('.menu-btn[title="Настройки"]').click();
  await page.locator('.drawer-menu-item').filter({ hasText: 'Настройки' }).click();
  await expect(page.locator('.settings-dialog-overlay.open')).toBeVisible();
}

test('real profile, wallpaper and notification preferences persist after reload without losing drafts', async ({ page }) => {
  await enterMockApp(page);
  await openSettings(page);
  await page.locator('#name-input').fill('Имя после сохранения');
  await page.locator('#bio-input').fill('Описание после сохранения');
  await page.locator('[data-section="appearance"]').click();
  await page.locator('.theme-selection-btn').nth(1).click();
  await expect(page.locator('.theme-selection-btn').nth(1)).toBeEnabled();
  // A valid tiny PNG exercises the existing mock upload path and profile persistence.
  await page.locator('.settings-dialog input[type="file"]').setInputFiles({
    name: 'wallpaper.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.getByRole('button', { name: 'Удалить обои' })).toBeEnabled();
  await page.locator('[data-section="notifications"]').click();
  await page.getByRole('switch', { name: 'Уведомления' }).uncheck();
  await expect(page.getByRole('switch', { name: 'Уведомления' })).toBeEnabled();
  await page.locator('[data-section="profile"]').click();
  await expect(page.locator('#name-input')).toHaveValue('Имя после сохранения');
  await expect(page.locator('#bio-input')).toHaveValue('Описание после сохранения');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.locator('.settings-dialog').getByRole('status')).toHaveText('Профиль сохранён.');
  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  await openSettings(page);
  await expect(page.locator('#name-input')).toHaveValue('Имя после сохранения');
  await expect(page.locator('#bio-input')).toHaveValue('Описание после сохранения');
  await page.locator('[data-section="appearance"]').click();
  await expect(page.locator('.theme-selection-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Удалить обои' })).toBeVisible();
  await page.locator('[data-section="notifications"]').click();
  await expect(page.getByRole('switch', { name: 'Уведомления' })).not.toBeChecked();
});

test('mobile profile entry opens directly and Back returns to the settings list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterMockApp(page);
  await page.locator('.menu-btn[title="Настройки"]').click();
  await page.locator('.drawer-menu-item').filter({ hasText: 'Мой профиль' }).click();
  await expect(page.locator('#name-input')).toBeVisible();
  await page.evaluate(() => window.handleAndroidBackButton());
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();
  await page.evaluate(() => window.handleAndroidBackButton());
  await expect(page.locator('.settings-dialog-overlay.open')).toHaveCount(0);
});
