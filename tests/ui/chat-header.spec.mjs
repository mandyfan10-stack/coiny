import { test, expect } from '@playwright/test';

test('header actions remain horizontal, keyboard accessible and retain the lock at all widths', async ({ page }) => {
  await page.goto('/tests/ui/settings-fixture.html');
  for (const width of [320, 390, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator('.chat-header').evaluate(header => {
      const buttons = [...header.querySelectorAll('.chat-header-actions button')].map(item => item.getBoundingClientRect());
      const lock = header.querySelector('.e2ee-header-lock-icon').getBoundingClientRect();
      const title = header.querySelector('.chat-header-title');
      return {
        horizontal: buttons[0].top === buttons[1].top,
        sizes: buttons.map(item => [item.width, item.height]),
        gap: buttons[1].left - buttons[0].right, right: buttons[1].right,
        lockFits: lock.right <= buttons[0].left && lock.width === 15,
        truncated: title.scrollWidth > title.clientWidth
      };
    });
    expect(bounds.horizontal).toBe(true);
    expect(bounds.sizes).toEqual([[44, 44], [44, 44]]);
    expect(bounds.gap).toBe(8);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.lockFits).toBe(true);
    expect(bounds.truncated).toBe(true);
    const search = page.getByRole('button', { name: 'Поиск в чате' });
    await search.focus(); await expect(search).toBeFocused();
    expect(await search.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Информация' })).toBeFocused();
  }
});

test('real chat search matches, keyboard navigation, empty result and closing preserve the reading position', async ({ page }) => {
  await page.goto('/tests/scroll/fixture.html?mock=1');
  await expect(page.locator('.message-row')).toHaveCount(200);
  const body = page.locator('.chat-body');
  await body.dispatchEvent('wheel', { deltaY: -1000 });
  await body.evaluate(element => { element.scrollTop = 8000; });
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Поиск в чате' }).click();
  const input = page.getByTestId('chat-search-input');
  await input.fill('Message 15');
  await expect(page.locator('.chat-search-counter')).toContainText('11');
  await expect(page.locator('mark')).not.toHaveCount(0);
  const counter = await page.locator('.chat-search-counter').textContent();
  await input.press('Enter');
  await expect(page.locator('.chat-search-counter')).not.toHaveText(counter);
  await input.press('Shift+Enter');
  await expect(page.locator('.chat-search-counter')).toHaveText(counter);
  await input.fill('no-such-message-in-history');
  await expect(page.locator('.chat-search-counter')).toContainText('Нет');
  await expect.poll(async () => {
    const top = await body.evaluate(element => element.scrollTop);
    await page.waitForTimeout(80);
    return Math.abs(top - await body.evaluate(element => element.scrollTop));
  }).toBeLessThan(0.5);
  const before = await body.evaluate(element => element.scrollTop);
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
  await page.keyboard.press('Control+f');
  await expect(page.getByTestId('chat-search-input')).toBeVisible();
});
