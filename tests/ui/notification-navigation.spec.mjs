import { test, expect } from '@playwright/test';

test('cold launch waits for the recipient session and chat list', async ({ page }) => {
  await page.goto('/tests/ui/notification-navigation-fixture.html?notificationChat=chat-1&notificationOwner=alice&invite=keep');
  await expect(page.locator('output')).toHaveText('none');
  await page.evaluate(() => window.__notifications.setUser({ id: 'alice' }));
  await expect(page.locator('output')).toHaveText('none');
  await page.evaluate(() => window.__notifications.setChats([{ id: 'chat-1' }]));
  await expect(page.locator('output')).toHaveText('chat-1');
  await expect(page).not.toHaveURL(/notificationChat/);
  await expect(page).toHaveURL(/invite=keep/);
});

test('another account cannot consume a notification target after switching accounts', async ({ page }) => {
  await page.goto('/tests/ui/notification-navigation-fixture.html?notificationChat=chat-1&notificationOwner=alice');
  await page.waitForFunction(() => window.__notifications);
  await page.evaluate(() => { window.__notifications.setChats([{ id: 'chat-1' }]); window.__notifications.setUser({ id: 'bob' }); });
  await expect(page).not.toHaveURL(/notificationChat/);
  await page.evaluate(() => window.__notifications.setUser({ id: 'alice' }));
  await expect(page.locator('output')).toHaveText('none');
});

test('service worker messages open an existing chat and ignore arbitrary payloads', async ({ page }) => {
  await page.goto('/tests/ui/notification-navigation-fixture.html');
  await page.waitForFunction(() => window.__notifications);
  await page.evaluate(() => {
    window.__notifications.setUser({ id: 'alice' });
    window.__notifications.setChats([{ id: 'chat-1' }]);
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'coiny:open-chat', target: { ownerId: 'alice', chatId: '../admin' } } }));
  });
  await expect(page.locator('output')).toHaveText('none');
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'coiny:open-chat', target: { ownerId: 'alice', chatId: 'chat-1' } } })));
  await expect(page.locator('output')).toHaveText('chat-1');
});

test('account probes identify the recipient tab without changing its active chat', async ({ page }) => {
  await page.goto('/tests/ui/notification-navigation-fixture.html');
  await page.waitForFunction(() => window.__notifications);
  await page.evaluate(() => window.__notifications.setUser({ id: 'alice' }));
  await page.waitForFunction(() => window.__notifications.currentUser?.id === 'alice');
  for (const ownerId of ['bob', 'alice']) {
    const accepted = await page.evaluate(owner => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data.accepted); };
      navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
        data: { type: 'coiny:notification-probe', target: { ownerId: owner, chatId: 'chat-1' } }, ports: [channel.port2]
      }));
    }), ownerId);
    expect(accepted).toBe(ownerId === 'alice');
  }
  await expect(page.locator('output')).toHaveText('none');
});
