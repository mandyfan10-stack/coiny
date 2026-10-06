import { test, expect } from '@playwright/test';

const fixture = '/tests/ui/message-delivery-fixture.html';
const item = (chatId, id) => ({
  queueId: id, chatId, senderId: 'delivery-self', optimisticId: id,
  text: `text-${id}`, isPending: true, isFailed: false
});

test('an unavailable first chat does not block other messages and resumes when metadata arrives', async ({ page }) => {
  await page.goto(fixture);
  await page.evaluate(items => window.__deliveryTest.queue(items), [item('missing', 'first'), item('group', 'second')]);
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.sent.map(args => args[5]))).toEqual(['second']);
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.state.queue.map(item => item.queueId))).toEqual(['first']);
  await page.evaluate(() => window.__deliveryTest.addChat({ id: 'missing', type: 'group', name: 'Loaded', members: [], messages: [] }));
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.sent.map(args => args[5]))).toEqual(['second', 'first']);
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.state.queue.length)).toBe(0);
});

test('a denied or unconfirmed delivery fails its entry and the queue continues', async ({ page }) => {
  for (const mode of ['permission', 'empty']) {
    await page.goto(fixture);
    await page.evaluate(mode => {
      window.__deliveryTest.modes.denied = mode;
      window.__deliveryTest.addChat({ id: 'denied', type: 'group', members: [], messages: [] });
    }, mode);
    await page.evaluate(items => window.__deliveryTest.queue(items), [item('denied', 'first'), item('group', 'second')]);
    await expect.poll(() => page.evaluate(() => window.__deliveryTest.sent.map(args => args[5]))).toEqual(['second']);
    await expect.poll(() => page.evaluate(() => window.__deliveryTest.state.queue.map(item => ({ id: item.queueId, failed: item.isFailed })))).toEqual([{ id: 'first', failed: true }]);
    expect(await page.evaluate(() => window.__deliveryTest.attempts.length)).toBe(2);
  }
});

test('a network failure preserves queue order for the next connection', async ({ page }) => {
  await page.goto(fixture);
  await page.evaluate(() => { window.__deliveryTest.modes.group = 'network'; });
  await page.evaluate(items => window.__deliveryTest.queue(items), [item('group', 'first'), item('group', 'second')]);
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.state.online)).toBe(false);
  expect(await page.evaluate(() => window.__deliveryTest.attempts.map(args => args[5]))).toEqual(['first']);
  expect(await page.evaluate(() => window.__deliveryTest.state.queue.map(item => item.queueId))).toEqual(['first', 'second']);
  await page.evaluate(() => {
    delete window.__deliveryTest.modes.group;
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.sent.map(args => args[5]))).toEqual(['first', 'second']);
});

test('the real chat formatter trusts only the RPC ID and personal sends fail closed for saved-name peers', async ({ page }) => {
  await page.goto(fixture);
  for (const peerName of ['Избранное', 'Saved Messages 🔖']) {
    const chats = await page.evaluate(peerName => window.__deliveryTest.fetchChats({ peerName }), peerName);
    expect(chats.find(chat => chat.id === 'saved').savedMessagesOwnerId).toBe('delivery-self');
    expect(chats.find(chat => chat.id === 'personal').savedMessagesOwnerId).toBeNull();
    await page.evaluate(chat => window.__deliveryTest.addChat(chat), chats.find(chat => chat.id === 'personal'));
    await page.evaluate(() => window.__deliveryTest.select('personal'));
    await page.evaluate(() => window.__deliveryTest.send('private text'));
    await expect.poll(() => page.evaluate(() => window.__deliveryTest.alerts.length)).toBe(peerName === 'Избранное' ? 1 : 2);
    expect(await page.evaluate(() => window.__deliveryTest.sent)).toEqual([]);
  }
  const chats = await page.evaluate(() => window.__deliveryTest.fetchChats());
  await page.evaluate(chat => window.__deliveryTest.addChat(chat), chats.find(chat => chat.id === 'saved'));
  await page.evaluate(() => window.__deliveryTest.select('saved'));
  await page.evaluate(() => window.__deliveryTest.send('self notes'));
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.sent.map(args => args[2]))).toEqual(['self notes']);
});

test('a failed saved-chat RPC or an RPC ID with a peer never bypasses E2EE', async ({ page }) => {
  await page.goto(fixture);
  const failed = await page.evaluate(() => window.__deliveryTest.fetchChats({ rpcFails: true }));
  expect(failed.every(chat => chat.savedMessagesOwnerId === null)).toBe(true);
  const unavailableCount = await page.evaluate(() => window.__deliveryTest.fetchChats({ countFails: true }));
  expect(unavailableCount.every(chat => chat.savedMessagesOwnerId === null)).toBe(true);
  const collision = await page.evaluate(() => window.__deliveryTest.fetchChats({ savedId: 'personal', omitPeer: true }));
  expect(collision.find(chat => chat.id === 'personal').members).toHaveLength(1);
  expect(collision.find(chat => chat.id === 'personal').savedMessagesOwnerId).toBeNull();
  await page.evaluate(chat => window.__deliveryTest.addChat(chat), collision.find(chat => chat.id === 'personal'));
  await page.evaluate(() => window.__deliveryTest.select('personal'));
  await page.evaluate(() => window.__deliveryTest.send('private text'));
  await expect.poll(() => page.evaluate(() => window.__deliveryTest.alerts.length)).toBe(1);
  expect(await page.evaluate(() => window.__deliveryTest.sent)).toEqual([]);
});
