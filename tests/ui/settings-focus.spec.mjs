import { test, expect } from '@playwright/test';

test('settings receive focus after delayed visibility in reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tests/ui/settings-fixture.html');
  // Reproduce a browser frame where the open class precedes actual visibility.
  await page.addStyleTag({ content: '.settings-dialog-overlay { transition: visibility 0s linear 180ms !important; }' });
  await page.getByRole('button', { name: 'Открыть настройки', exact: true }).click();
  const close = page.getByRole('button', { name: 'Закрыть настройки' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.settings-dialog')).toContainText('Профиль');
  expect(await page.locator('.settings-dialog').evaluate(node => node.contains(document.activeElement))).toBe(true);
});

test('closing before visibility cancels deferred focus and reopening works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tests/ui/settings-fixture.html');
  await page.addStyleTag({ content: '.settings-dialog-overlay { transition: visibility 0s linear 500ms !important; }' });
  const trigger = page.getByRole('button', { name: 'Открыть настройки', exact: true });
  await trigger.click();
  await expect(page.locator('.settings-dialog-overlay')).toHaveClass(/open/);
  await page.evaluate(() => window.__settingsTest.ui.setIsSettingsOpen(false));
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('button', { name: 'Закрыть настройки' })).toBeFocused();
});
