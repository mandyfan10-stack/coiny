import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadE2eAccounts,
  loginAndUnlock,
  openPersonalChat,
} from './helpers.mjs';

const accounts = loadE2eAccounts();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, '../../test-results/reaction-drawer');

test.skip(
  accounts.missing.length > 0,
  `Live reaction-drawer E2E requires: ${accounts.missing.join(', ')}`,
);

/**
 * Verifies the reaction emoji bar is not clipped/squeezed for messages
 * near the top of the chat (the original UI bug).
 */
test('reaction drawer stays wide and fully visible at chat top', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAndUnlock(page, accounts.first);
  await openPersonalChat(page, accounts.second.username);

  const textarea = page.locator('.chat-footer-input textarea, textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 20_000 });

  // Seed a few messages so the list is non-empty, then use the top-most one.
  const marker = `E2E-REACT-TOP-${Date.now()}`;
  for (let i = 0; i < 3; i += 1) {
    await textarea.fill(`${marker}-${i}`);
    const sendBtn = page.locator('.send-message-btn').first();
    if (await sendBtn.isVisible().catch(() => false)) await sendBtn.click();
    else await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }

  const chatBody = page.locator('.chat-body').first();
  await chatBody.waitFor({ state: 'visible' });

  // Scroll to the very top — this is where the old absolute drawer got clipped.
  await chatBody.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(300);

  // Prefer our just-sent marker so the target is deterministic; if history is long,
  // scroll that row to the top of the chat viewport (the failure case).
  let targetRow = page.locator('.message-row').filter({ hasText: `${marker}-0` }).first();
  if (!(await targetRow.isVisible().catch(() => false))) {
    targetRow = page.locator('.message-row').first();
  }
  await expect(targetRow).toBeVisible({ timeout: 15_000 });

  await targetRow.evaluate((el) => {
    el.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  // Nudge so the row sits flush under the header / top of scroll area
  await chatBody.evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollTop - 8);
  });
  await page.waitForTimeout(200);

  // Exercise the actual mouse path so clipped or unreachable controls fail the test.
  await targetRow.locator('.message-bubble').hover();
  const smileBtn = page.locator('.hover-action-btn[title="Реакция"]').first();
  await expect(smileBtn).toBeVisible();
  await smileBtn.click();

  const drawer = page.locator('.reaction-drawer').first();
  await expect(drawer).toBeAttached({ timeout: 8_000 });
  // Wait until layout effect places it (visibility: visible)
  await expect
    .poll(async () => {
      return drawer.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const v = getComputedStyle(el).visibility;
        return v === 'visible' && r.width > 100;
      });
    }, { timeout: 5_000 })
    .toBe(true);

  const metrics = await drawer.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const items = [...el.querySelectorAll('.reaction-drawer-item')].map((item) => {
      const r = item.getBoundingClientRect();
      return { w: r.width, h: r.height, text: item.textContent?.trim() || '' };
    });
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      visibility: style.visibility,
      overflow: style.overflow,
      itemCount: items.length,
      items,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    };
  });

  // Debug artifact for humans
  await page.screenshot({
    path: path.join(shotDir, `top-message-reaction-${testInfo.project.name}.png`),
    fullPage: false,
  });
  console.log('reaction drawer metrics:', JSON.stringify(metrics, null, 2));

  // Core assertions for the bug: drawer must not be a narrow sliver
  expect(metrics.visibility).toBe('visible');
  expect(metrics.itemCount).toBeGreaterThanOrEqual(6);
  expect(metrics.width, `drawer too narrow: ${metrics.width}px`).toBeGreaterThan(160);
  expect(metrics.height, `drawer too short: ${metrics.height}px`).toBeGreaterThan(24);

  // Fully inside the viewport (not clipped at edges)
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportW + 1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportH + 1);

  // Each emoji cell must be readable
  for (const item of metrics.items) {
    expect(item.w, `emoji cell too narrow: ${item.text}`).toBeGreaterThan(16);
    expect(item.h, `emoji cell too short: ${item.text}`).toBeGreaterThan(16);
    expect(item.text.length).toBeGreaterThan(0);
  }

  // Scroll the chat while drawer is open — it should reposition or stay usable.
  await chatBody.evaluate((el) => {
    el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + 40);
  });
  await page.waitForTimeout(200);

  const stillOpen = await drawer.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).visibility === 'visible' && r.width > 100;
  }).catch(() => false);
  if (!stillOpen) {
    await targetRow.scrollIntoViewIfNeeded();
    await targetRow.locator('.message-bubble').hover();
    await smileBtn.click();
    await expect
      .poll(async () => drawer.evaluate((el) => el.getBoundingClientRect().width > 100), { timeout: 5_000 })
      .toBe(true);
  }

  const finalWidth = await drawer.evaluate((el) => el.getBoundingClientRect().width);
  expect(finalWidth).toBeGreaterThan(160);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
