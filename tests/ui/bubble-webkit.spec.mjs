import { test, expect } from '@playwright/test';

for (const strategy of ['path', 'svg']) {
test(`bubble geometry ${strategy} renders without invalid React WebKit style warnings`, async ({ page }) => {
  if (strategy === 'svg') await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => args.some(arg => String(arg).includes('path(')) ? false : supports(...args);
  });
  const styleWarnings = [];
  page.on('console', item => { if (/Unsupported style property|Invalid value.*clip/i.test(item.text())) styleWarnings.push(item.text()); });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/tests/ui/messenger-fixture.html');
  await page.evaluate(() => window.__messengerTest.select('a'));
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(2);
  await page.evaluate(() => {
    window.__messengerTest.complete('cache', 'a');
    window.__messengerTest.complete('network', 'a', [{ id: 'bubble', text: 'Проверка скруглений сообщения', senderId: 'messenger-self', timestamp: new Date().toISOString(), read: true, reactions: [] }]);
  });
  const bubble = page.locator('.message-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveClass(/custom-geometry-active/);
  await expect.poll(() => bubble.evaluate(node => getComputedStyle(node).clipPath)).toMatch(/path\(|url\(/);
  expect(await bubble.evaluate(node => node.style.webkitClipPath)).toMatch(/path\(|url\(/);
  expect(styleWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});
}
