import { test, expect } from '@playwright/test';
import { enterMockApp } from './helpers.mjs';

const loadedScripts = (page) => page.evaluate(() => (
  performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.js'))
));

test('secondary UI chunks load only when their surfaces open', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await enterMockApp(page);

  const initialScripts = await loadedScripts(page);
  expect(initialScripts.some((name) => name.includes('SettingsModal-'))).toBe(false);
  expect(initialScripts.some((name) => name.includes('StickersTab-'))).toBe(false);
  expect(initialScripts.some((name) => name.includes('PulsePanel-'))).toBe(false);
  expect(initialScripts.some((name) => name.includes('CallOverlay-'))).toBe(false);

  await page.locator('.menu-btn[title="Настройки"]').click();
  await page.locator('.drawer-menu-item').filter({ hasText: 'Настройки' }).click();
  await expect(page.locator('.settings-modal-overlay.open')).toBeVisible();
  await expect.poll(async () => (
    (await loadedScripts(page)).some((name) => name.includes('SettingsModal-'))
  )).toBe(true);
  await expect.poll(() => page.evaluate(() => document.activeElement?.className || '')).toContain('settings-close-btn');

  await page.locator('.settings-nav-item').filter({ hasText: 'Стикеры' }).click();
  await expect.poll(async () => (
    (await loadedScripts(page)).some((name) => name.includes('StickersTab-'))
  )).toBe(true);
  const settingsOverlay = page.locator('.settings-container[role="dialog"]').locator('..');
  const settingsCloseButton = page.locator('.settings-modal-overlay.open .settings-close-btn');
  await settingsCloseButton.click();
  await expect(settingsOverlay).toBeHidden();
  await expect(page.locator('.menu-btn[title="Настройки"]')).toBeFocused();

  await page.locator('[data-chat-username="echo_bot"]').click();
  await page.locator('.chat-header').click();
  await page.getByRole('button', { name: 'Звонок', exact: true }).click();
  await expect(page.locator('.call-overlay-wrapper.active')).toBeVisible();
  await expect.poll(async () => (
    (await loadedScripts(page)).some((name) => name.includes('CallOverlay-'))
  )).toBe(true);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('settings focus and presence remain stable during rapid mobile reopen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enterMockApp(page);
  const menuButton = page.locator('.menu-btn[title="Настройки"]');
  const settingsItem = page.locator('.drawer-menu-item').filter({ hasText: 'Настройки' });
  const dialog = page.locator('.settings-container[role="dialog"]');
  const overlay = dialog.locator('..');
  const closeButton = dialog.locator('.settings-close-btn');
  await menuButton.click(); await settingsItem.click();
  await expect(dialog).toBeVisible(); await expect(closeButton).toBeFocused();
  await expect(dialog.locator('.settings-nav-item[data-section]')).toHaveCount(6);
  await expect(dialog.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();
  const assertGeometry = async () => {
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const body = element.querySelector('.settings-body');
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: body.clientWidth, scrollWidth: body.scrollWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(360);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(800);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  };
  await assertGeometry();
  for (const section of ['appearance', 'notifications', 'stickers', 'security', 'storage', 'profile']) {
    await dialog.locator(`[data-section="${section}"]`).click();
    await assertGeometry();
    await dialog.getByRole('button', { name: 'Назад к настройкам' }).click();
    await expect(dialog.locator('.settings-nav-item[data-section]')).toHaveCount(6);
  }
  const logout = dialog.getByRole('button', { name: 'Выйти из аккаунта' });
  await closeButton.focus(); await page.keyboard.press('Shift+Tab'); await expect(logout).toBeFocused();
  await page.keyboard.press('Tab'); await expect(closeButton).toBeFocused();
  await closeButton.click();
  await menuButton.click(); await settingsItem.click();
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(350); await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden(); await expect(menuButton).toBeFocused();
});

test('settings honors reduced motion without delayed focus restoration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterMockApp(page);

  const menuButton = page.locator('.menu-btn[title="Настройки"]');
  await menuButton.click();
  await page.locator('.drawer-menu-item').filter({ hasText: 'Настройки' }).click();

  const dialog = page.locator('.settings-container[role="dialog"]');
  const overlay = dialog.locator('..');
  await expect(dialog.locator('.settings-close-btn')).toBeFocused();

  const motion = await dialog.evaluate((element) => ({
    transform: getComputedStyle(element).transform,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(motion.transform).toBe('none');
  expect(motion.transitionDuration.split(',').every((value) => Number.parseFloat(value) <= 0.001)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(menuButton).toBeFocused();
});
