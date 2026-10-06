import { expect, test } from '@playwright/test';
import { enterMockApp } from './helpers.mjs';

async function openProfileSettings(page) {
  const menuButton = page.locator('.menu-btn[title="Настройки"]');
  await menuButton.click();
  await page.locator('.drawer-menu-item').filter({ hasText: 'Мой профиль' }).click();
  const dialog = page.getByRole('dialog', { name: 'Профиль' });
  await expect(dialog).toBeVisible();
  return { dialog, menuButton };
}

test('custom profile styling is gone from mock settings', async ({ page }) => {
  await enterMockApp(page);
  const { dialog } = await openProfileSettings(page);

  await expect(page.locator('.drawer-menu-item').filter({ hasText: 'Оформление профиля' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Своё оформление' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^(Загрузить|Заменить|Снять)$/ })).toHaveCount(0);
  await expect(dialog.getByText('Рамка')).toHaveCount(0);
  await expect(dialog.getByText('Значок')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Загрузить обложку' })).toBeVisible();
});

test('profile header uses a compact identity row at 806x590', async ({ page }) => {
  await page.setViewportSize({ width: 806, height: 590 });
  await enterMockApp(page);
  const { dialog } = await openProfileSettings(page);
  const preview = dialog.getByTestId('live-profile-preview');
  const banner = dialog.getByTestId('profile-preview-banner');
  const body = dialog.getByTestId('profile-preview-body');
  const avatar = dialog.getByTestId('profile-preview-avatar');
  const identity = dialog.getByTestId('profile-preview-identity');
  await expect(preview).toBeVisible();

  const [previewBox, bannerBox, bodyBox, avatarBox, identityBox] = await Promise.all([
    preview.boundingBox(), banner.boundingBox(), body.boundingBox(), avatar.boundingBox(), identity.boundingBox(),
  ]);
  expect(previewBox.height).toBeGreaterThanOrEqual(160);
  expect(previewBox.height).toBeLessThanOrEqual(180);
  expect(bannerBox.height).toBeGreaterThanOrEqual(94);
  expect(bodyBox.height).toBeLessThanOrEqual(90);
  expect(avatarBox.height).toBeGreaterThanOrEqual(62);
  expect(identityBox.x).toBeGreaterThan(avatarBox.x + avatarBox.width);
  expect(identityBox.y + (identityBox.height / 2)).toBeLessThan(
    avatarBox.y + avatarBox.height,
  );
  await expect(avatar).toHaveCSS('overflow', 'visible');

  const bodyGeometry = await dialog.locator('.settings-body').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(bodyGeometry.scrollHeight).toBeGreaterThan(bodyGeometry.clientHeight);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(806);
});

test('compact profile header stays dense on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterMockApp(page);
  const { dialog } = await openProfileSettings(page);
  const preview = dialog.getByTestId('live-profile-preview');
  const body = dialog.getByTestId('profile-preview-body');
  const avatar = dialog.getByTestId('profile-preview-avatar');
  const identity = dialog.getByTestId('profile-preview-identity');

  const [previewBox, bodyBox, avatarBox, identityBox] = await Promise.all([
    preview.boundingBox(), body.boundingBox(), avatar.boundingBox(), identity.boundingBox(),
  ]);
  expect(previewBox.height).toBeLessThanOrEqual(200);
  expect(bodyBox.height).toBeLessThanOrEqual(90);
  expect(identityBox.x).toBeGreaterThan(avatarBox.x + avatarBox.width);
  expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
