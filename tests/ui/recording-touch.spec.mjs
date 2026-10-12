import { test, expect } from '@playwright/test';

test.use({
  permissions: ['microphone', 'camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

for (const gesture of ['lock', 'cancel']) {
  test(`trusted touch swipe can ${gesture} a voice recording`, async ({ page, context, isMobile, browserName }) => {
    test.skip(!isMobile || browserName !== 'chromium', 'Native touch input through Chromium CDP');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 640 });
      await page.goto('/tests/ui/interface-fixture.html');
      const button = page.getByRole('button', { name: 'Голосовое сообщение', exact: true });
      await expect(button).toBeVisible();
      await page.evaluate(() => {
        window.__recordPointerCancellations = 0;
        document.addEventListener('pointercancel', () => { window.__recordPointerCancellations++; });
      });
      const box = await button.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const client = await context.newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await expect(page.locator('.recording-panel')).toBeVisible();
      for (let step = 1; step <= 6; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: gesture === 'cancel' ? x - step * 22 : x, y: gesture === 'lock' ? y - step * 22 : y }]
        });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
      expect(await page.evaluate(() => window.__recordPointerCancellations)).toBe(0);
      if (gesture === 'lock') {
        await expect(page.locator('.recording-panel.locked')).toBeVisible();
        await page.getByRole('button', { name: 'Приостановить запись', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Продолжить запись', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Продолжить запись', exact: true }).click();
        await page.getByRole('button', { name: 'Удалить запись', exact: true }).click();
      }
      await expect(page.locator('.recording-panel')).toHaveCount(0);
      await expect(page.locator('.message-row')).toHaveCount(6);
    }
  });
}
