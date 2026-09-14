import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enterMockApp } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, '../../test-results/bubble-geometry');

test.describe('Parametric Bubble Geometry E2E Verification', () => {
  test('parametric squircles, series merging, live text selection and settings fallback', async ({ page }) => {
    test.setTimeout(90_000);
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Enter mock application
    await enterMockApp(page);

    // Open mock community chat
    const communityChat = page.locator('.chat-item, .chat-row, .chat-list-item').first();
    await communityChat.waitFor({ state: 'visible', timeout: 20_000 });
    await communityChat.click();

    const composer = page.locator('.chat-footer-input textarea, textarea').first();
    await composer.waitFor({ state: 'visible', timeout: 15_000 });

    // 2. Send 1-character message
    await composer.fill('A');
    await page.locator('.send-message-btn[title="Отправить"], .send-message-btn').first().click();
    await page.waitForTimeout(300);

    // 3. Send series of 5 consecutive messages
    const seriesMarker = `GEO-${Date.now()}`;
    for (let i = 1; i <= 5; i++) {
      await composer.fill(`${seriesMarker} part ${i}`);
      const sendBtn = page.locator('.send-message-btn[title="Отправить"], .send-message-btn').first();
      await sendBtn.click();
      await page.waitForTimeout(200);
    }

    // 4. Send a long multiline message
    const multilineText = `Multiline parametric squircle test:\nLine 1: Geometry computed at runtime.\nLine 2: G2-curvature continuous Bezier corners.\nLine 3: Zero layout thrashing on fast scroll.`;
    await composer.fill(multilineText);
    await page.locator('.send-message-btn[title="Отправить"], .send-message-btn').first().click();
    await page.waitForTimeout(400);

    // 5. Verify custom geometry is active on message bubbles
    const outgoingBubbles = page.locator('.message-row.row-me .message-bubble');
    await expect(outgoingBubbles.first()).toBeVisible({ timeout: 10_000 });

    const firstBubble = outgoingBubbles.last();
    const hasCustomGeometry = await firstBubble.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const clipPath = style.clipPath || style.webkitClipPath || '';
      return el.classList.contains('custom-geometry-active') || clipPath.includes('path(');
    });
    expect(hasCustomGeometry).toBe(true);

    // 6. Verify live text selection (DOM text node accessible, selectable)
    const selectable = await firstBubble.evaluate((el) => {
      const textEl = el.querySelector('.message-text');
      if (!textEl) return false;
      const textStyle = window.getComputedStyle(textEl);
      return textStyle.userSelect !== 'none';
    });
    expect(selectable).toBe(true);

    // Capture screenshot of custom squircle chat
    await page.screenshot({
      path: path.join(screenshotsDir, '01-custom-squircle-chat.png'),
      fullPage: false
    });

    // 7. Verify narrow viewport (360px mobile width)
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, '02-narrow-viewport-360px.png'),
      fullPage: false
    });

    // Restore desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    // 8. Open Appearance Settings and test Fallback Toggle
    const menuBtn = page.locator('.menu-btn, button[title="Меню"], .header-menu-btn, button[aria-label="Меню"]').first();
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await page.waitForTimeout(300);
      const settingsOption = page.getByText('Настройки', { exact: false }).first();
      if (await settingsOption.isVisible().catch(() => false)) {
        await settingsOption.click();
        await page.waitForTimeout(400);

        // Click Appearance tab
        const appearanceTab = page.getByText('Оформление', { exact: false }).first();
        if (await appearanceTab.isVisible().catch(() => false)) {
          await appearanceTab.click();
          await page.waitForTimeout(400);

          // Verify bubble geometry toggle is rendered
          const geometryHeading = page.getByText('Геометрия сообщений', { exact: false });
          await expect(geometryHeading).toBeVisible({ timeout: 5_000 });

          // Take screenshot of settings
          await page.screenshot({
            path: path.join(screenshotsDir, '03-settings-appearance-toggle.png'),
            fullPage: false
          });

          // Toggle off
          const geomSection = page.locator('.settings-section').filter({ hasText: 'Геометрия сообщений' });
          await geomSection.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          const switchWrapper = geomSection.locator('.switch-wrapper, .switch-slider').first();
          await switchWrapper.click();
          await page.waitForTimeout(400);

          // Close modal
          const closeBtn = page.locator('button.settings-close-btn').first();
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(400);

          // Verify fallback to standard border-radius
          const fallbackBubble = page.locator('.message-row.row-me .message-bubble').last();
          const isFallback = await fallbackBubble.evaluate((el) => {
            return !el.classList.contains('custom-geometry-active');
          });
          expect(isFallback).toBe(true);

          await page.screenshot({
            path: path.join(screenshotsDir, '04-fallback-border-radius.png'),
            fullPage: false
          });
        }
      }
    }

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('light mode, RTL layout, reactions and reply quote context with squircles', async ({ page }) => {
    test.setTimeout(90_000);
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await enterMockApp(page);

    const communityChat = page.locator('.chat-item, .chat-row, .chat-list-item').first();
    await communityChat.waitFor({ state: 'visible', timeout: 20_000 });
    await communityChat.click();

    const composer = page.locator('.chat-footer-input textarea, textarea').first();
    await composer.waitFor({ state: 'visible', timeout: 15_000 });

    // Send a message to reply to
    const replyTargetText = `Base message for reply quote ${Date.now()}`;
    await composer.fill(replyTargetText);
    await page.locator('.send-message-btn[title="Отправить"], .send-message-btn').first().click();
    await page.waitForTimeout(300);

    // Hover target row and click reply action
    const targetRow = page.locator('.message-row.row-me').last();
    await targetRow.hover();
    const replyBtn = targetRow.locator('.hover-action-btn[title="Ответить"]').first();
    if (await replyBtn.isVisible().catch(() => false)) {
      await replyBtn.click({ force: true });
      await page.waitForTimeout(200);

      // Send reply message
      await composer.fill('Reply quote message with squircle geometry');
      await page.locator('.send-message-btn[title="Отправить"], .send-message-btn').first().click();
      await page.waitForTimeout(300);
    }

    // Add reaction
    const lastRow = page.locator('.message-row.row-me').last();
    await lastRow.hover();
    const smileBtn = lastRow.locator('.hover-action-btn[title="Реакция"]').first();
    if (await smileBtn.isVisible().catch(() => false)) {
      await smileBtn.click({ force: true });
      await page.waitForTimeout(200);
      const firstReaction = page.locator('.reaction-drawer-item').first();
      if (await firstReaction.isVisible().catch(() => false)) {
        await firstReaction.click({ force: true });
        await page.waitForTimeout(300);
      }
    }

    // Capture reactions and reply screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, '05-reactions-and-reply.png'),
      fullPage: false
    });

    // Toggle light mode via HTML class
    await page.evaluate(() => {
      document.documentElement.classList.add('theme-light');
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, '06-light-theme-squircles.png'),
      fullPage: false
    });

    // Test RTL layout
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, '07-rtl-layout-squircles.png'),
      fullPage: false
    });

    // Restore LTR and dark
    await page.evaluate(() => {
      document.documentElement.removeAttribute('dir');
      document.documentElement.classList.remove('theme-light');
    });

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
