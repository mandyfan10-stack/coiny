import { test, expect } from '@playwright/test';

async function loadMessages(page, historyLength = 0) {
  await page.goto('/tests/ui/messenger-fixture.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__messengerTest?.select));
  await page.evaluate(() => window.__messengerTest.select('a'));
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(2);
  await page.evaluate(historyLength => {
    window.__messengerTest.complete('cache', 'a');
    window.__messengerTest.complete('network', 'a', [
      ...Array.from({ length: historyLength }, (_, index) => ({ id: `older-${index}`, text: `Сообщение истории ${index} ${'длинный текст '.repeat(5)}`, senderId: 'peer', timestamp: new Date(Date.UTC(2026, 9, 6, 10, index)).toISOString(), reactions: [] })),
      { id: 'incoming', text: 'Входящее сообщение', senderId: 'peer', timestamp: '2026-10-06T12:00:00Z', reactions: [] },
      { id: 'outgoing', text: 'Исходящее сообщение', senderId: 'messenger-self', timestamp: '2026-10-06T12:01:00Z', reactions: [] }
    ]);
  }, historyLength);
  await expect(page.locator('.message-row')).toHaveCount(historyLength + 2);
}

for (const strategy of ['path', 'svg', 'legacy']) {
  test(`mouse hover opens reachable reaction controls with ${strategy} bubbles`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop mouse interaction');
    if (strategy === 'legacy') await page.addInitScript(() => localStorage.setItem('coiny_custom_bubble_geometry', 'false'));
    if (strategy === 'svg') await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...args) => args.some(arg => String(arg).includes('path(')) ? false : supports(...args);
    });
    await loadMessages(page);
    for (const id of ['incoming', 'outgoing']) {
      const bubble = page.locator(`[data-message-id="${id}"] .message-bubble`);
      if (strategy === 'legacy') await expect(bubble).not.toHaveClass(/custom-geometry-active/);
      else await expect(bubble).toHaveClass(/custom-geometry-active/);
      await bubble.hover();
      const button = page.locator(`[data-message-id="${id}"] .hover-action-btn[title="Реакция"], .message-hover-actions[data-message-actions-for="${id}"] .hover-action-btn[title="Реакция"]`);
      await expect(button).toHaveCount(1);
      await expect.poll(() => button.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
      await button.click();
      const drawer = page.getByRole('listbox', { name: 'Реакции' });
      await expect(drawer).toBeVisible();
      await drawer.getByRole('option', { name: '👍', exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await expect(page.locator(`[data-message-id="${id}"] .reaction-badge`)).toContainText('👍');
      await page.locator(`[data-message-id="${id}"] .reaction-badge`).click();
      await expect(page.locator(`[data-message-id="${id}"] .reaction-badge`)).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.__messengerTest.reactionCalls)).toEqual([
      { chatId: 'a', messageId: 'incoming', emoji: '👍' },
      { chatId: 'a', messageId: 'incoming', emoji: '👍' },
      { chatId: 'a', messageId: 'outgoing', emoji: '👍' },
      { chatId: 'a', messageId: 'outgoing', emoji: '👍' }
    ]);
  });
}

test('desktop reaction controls stay reachable at the viewport edges and close normally', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop mouse interaction');
  await loadMessages(page, 40);
  for (const width of [769, 1024, 1920]) {
    await page.setViewportSize({ width, height: 600 });
    const row = page.locator('[data-message-id="older-15"]');
    await row.evaluate(node => node.scrollIntoView({ block: 'start' }));
    await row.locator('.message-bubble').hover();
    const actions = page.getByRole('toolbar', { name: 'Действия сообщения' });
    await expect(actions).toBeVisible();
    const button = actions.getByRole('button', { name: 'Реакция', exact: true });
    const rect = await button.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 10 });
    await expect.poll(() => button.evaluate(node => node.contains(document.elementFromPoint(...[
      node.getBoundingClientRect().x + node.offsetWidth / 2,
      node.getBoundingClientRect().y + node.offsetHeight / 2
    ])))).toBe(true);
    await button.click();
    const drawer = page.getByRole('listbox', { name: 'Реакции' });
    await expect(drawer).toBeVisible();
    await expect.poll(async () => {
      const box = await drawer.boundingBox();
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 600;
    }).toBe(true);
    await page.locator('.chat-body').evaluate(node => { node.scrollTop += 10; });
    await expect(drawer).toBeVisible();
    await expect.poll(async () => {
      const anchor = await button.boundingBox();
      const box = await drawer.boundingBox();
      return box.y >= anchor.y + anchor.height || box.y + box.height <= anchor.y;
    }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await page.locator('.chat-header').click();
    await page.mouse.move(width - 2, 2);
    await expect(actions).toHaveCount(0);
  }
});

test('desktop keyboard can select a reaction and a chat switch removes its controls', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop keyboard interaction');
  await loadMessages(page);
  await page.locator('[data-message-id="incoming"] .message-bubble').hover();
  const button = page.getByRole('toolbar', { name: 'Действия сообщения' }).getByRole('button', { name: 'Реакция', exact: true });
  await button.press('Enter');
  await page.getByRole('option', { name: '👍', exact: true }).press('Enter');
  await expect(page.locator('[data-message-id="incoming"] .reaction-badge')).toContainText('👍');
  await page.locator('[data-message-id="incoming"] .message-bubble').hover();
  await button.click();
  await expect(page.getByRole('listbox', { name: 'Реакции' })).toBeVisible();
  await page.evaluate(() => window.__messengerTest.select('b'));
  await expect(page.getByRole('listbox', { name: 'Реакции' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Действия сообщения' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(4);
  await page.evaluate(() => {
    window.__messengerTest.complete('cache', 'b');
    window.__messengerTest.complete('network', 'b', [{ id: 'new-chat-message', text: 'Другой чат', senderId: 'peer', timestamp: '2026-10-06T12:00:00Z', reactions: [] }]);
  });
  await page.locator('[data-message-id="new-chat-message"] .message-bubble').hover();
  await expect(page.getByRole('toolbar', { name: 'Действия сообщения' })).toBeVisible();
});

test('touch reactions use the existing mobile sheet without desktop controls', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile touch interaction');
  await loadMessages(page);
  await page.locator('[data-message-id="incoming"] .message-text > span').first().tap();
  await expect(page.getByRole('toolbar', { name: 'Быстрые реакции' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Действия сообщения' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Реакция 👍', exact: true }).click();
  await expect(page.locator('[data-message-id="incoming"] .reaction-badge')).toContainText('👍');
  await expect(page.locator('.mobile-action-sheet')).toHaveCount(0);
  await page.locator('[data-message-id="incoming"] .message-text > span').first().tap();
  await expect(page.locator('.mobile-action-sheet')).toBeVisible();
  await page.evaluate(() => {
    window.__headerClicks = 0;
    document.querySelector('.chat-header').addEventListener('click', () => window.__headerClicks++, true);
  });
  await page.locator('.mobile-action-sheet-backdrop').tap({ position: { x: 10, y: 10 } });
  await expect(page.locator('.mobile-action-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => window.__headerClicks)).toBe(0);
});
