import { test, expect } from '@playwright/test';
import { enterMockApp } from './helpers.mjs';

async function openChat(page) {
  await enterMockApp(page);
  await page.locator('.chat-item, .chat-row, .chat-list-item').first().click();
  const composer = page.locator('.chat-footer-input textarea, textarea').first();
  await expect(composer).toBeVisible();
  return composer;
}

test('Telegram bubbles support sending, native hover reactions and quoted replies', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('coiny_custom_bubble_geometry', 'true'));
  const composer = await openChat(page);
  const marker = 'BUBBLE-' + Date.now();
  for (let index = 1; index <= 3; index++) {
    await composer.fill(marker + ' ' + index);
    await page.locator('.send-message-btn').click();
    await expect(page.locator('.message-row').filter({ hasText: marker + ' ' + index })).toBeVisible();
  }
  const target = page.locator('.message-row').filter({ hasText: marker + ' 3' });
  const bubble = target.locator('.message-bubble');
  await expect(bubble).toHaveCSS('clip-path', 'none');
  await expect(bubble).toHaveCSS('border-top-right-radius', '6px');
  await expect(bubble).toHaveCSS('border-bottom-right-radius', '4px');
  await bubble.hover();
  await page.getByRole('toolbar', { name: 'Действия сообщения' }).getByRole('button', { name: 'Реакция', exact: true }).press('Enter');
  await page.getByRole('listbox', { name: 'Реакции' }).getByRole('option', { name: '👍', exact: true }).click();
  await expect(target.locator('.reaction-badge')).toContainText('👍');
  await expect(bubble).toHaveCSS('border-bottom-right-radius', '4px');
  await target.locator('.reaction-badge').click();
  await expect(target.locator('.reaction-badge')).toHaveCount(0);
  await bubble.hover();
  await page.getByRole('toolbar', { name: 'Действия сообщения' }).getByRole('button', { name: 'Ответить', exact: true }).click();
  await composer.fill(marker + ' reply');
  await page.locator('.send-message-btn').click();
  const reply = page.locator('.message-row').filter({ hasText: marker + ' reply' });
  await expect(reply.locator('.reply-preview-bubble')).toContainText(marker + ' 3');
  await expect(reply.locator('.message-bubble')).toHaveCSS('clip-path', 'none');
});

test('ordinary bubbles retain text selection, narrow layouts, light mode and RTL', async ({ page }) => {
  const composer = await openChat(page);
  const marker = 'LAYOUT-' + Date.now();
  await composer.fill(marker + '\nНесколько строк текста и ссылка https://example.com/' + 'long'.repeat(35));
  await page.locator('.send-message-btn').click();
  const bubble = page.locator('.message-row').filter({ hasText: marker }).locator('.message-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('.message-text')).toHaveCSS('user-select', 'text');
  for (const width of [320, 390, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await bubble.scrollIntoViewIfNeeded();
    await expect(bubble).toHaveCSS('clip-path', 'none');
    expect(await bubble.evaluate(node => node.scrollWidth <= node.clientWidth + 8)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(() => {
    document.documentElement.classList.add('theme-light');
    document.documentElement.setAttribute('dir', 'rtl');
  });
  await bubble.scrollIntoViewIfNeeded();
  await expect(bubble).toHaveCSS('clip-path', 'none');
  await expect(bubble).not.toHaveClass(/custom-geometry-active/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const before = await bubble.evaluate(node => getComputedStyle(node).borderRadius);
  await bubble.hover();
  expect(await bubble.evaluate(node => getComputedStyle(node).borderRadius)).toBe(before);
});
