import { test, expect } from '@playwright/test';

const fixture = '/tests/ui/messenger-fixture.html';
const message = (id, text, minute = 0) => ({ id, text, senderId: 'peer', timestamp: new Date(Date.UTC(2026, 9, 6, 12, minute)).toISOString(), read: true, reactions: [] });
const state = page => page.evaluate(() => window.__messengerTest.state);
const complete = (page, kind, id, messages = [], error = null) => page.evaluate(args => window.__messengerTest.complete(...args), [kind, id, messages, error]);
const completeIndex = (page, index, messages = []) => page.evaluate(args => window.__messengerTest.completeIndex(...args), [index, messages]);
async function openChat(page, id = 'a') {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto(fixture);
  await page.evaluate(id => window.__messengerTest.select(id), id);
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(2);
}

for (const first of ['cache', 'network']) {
  test(`empty history finishes when ${first} resolves first`, async ({ page }) => {
    await openChat(page);
    await expect(page.locator('.chat-skeleton-container')).toBeVisible();
    await complete(page, first, 'a');
    if (first === 'cache') await expect(page.locator('.chat-skeleton-container')).toBeVisible();
    else await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
    await complete(page, first === 'cache' ? 'network' : 'cache', 'a');
    await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
    await expect(page.locator('.chat-skeleton-container')).toHaveCount(0);
    expect((await state(page)).loading.a).toBe(false);
    expect((await state(page)).syncing.a).toBe(false);
  });
}

test('cached messages stay visible during failure and retry, then reconcile with a successful history', async ({ page }) => {
  await openChat(page);
  await complete(page, 'cache', 'a', [message('cached', 'Сохранённое сообщение')]);
  await expect(page.getByText('Сохранённое сообщение')).toBeVisible();
  await expect(page.locator('.chat-skeleton-container')).toHaveCount(0);
  await complete(page, 'network', 'a', [], 'Fixture network error');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить сообщения');
  await expect(page.getByText('Сохранённое сообщение')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByText('Сохранённое сообщение')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await complete(page, 'network', 'a', [message('fresh', 'Новое сообщение', 1)]);
  await expect(page.getByText('Новое сообщение')).toBeVisible();
  await expect(page.getByText('Сохранённое сообщение')).toHaveCount(0);
});

test('an empty failed request is not presented as an empty successful history', async ({ page }) => {
  await openChat(page);
  await complete(page, 'cache', 'a');
  await complete(page, 'network', 'a', [], 'Fixture request failure');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Здесь пока нет сообщений')).toHaveCount(0);
  await expect(page.locator('.chat-skeleton-container')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('.chat-skeleton-container')).toBeVisible();
  await complete(page, 'network', 'a');
  await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
});

test('late cache preserves newer bodies and receipts while restoring older history', async ({ page }) => {
  await openChat(page);
  await complete(page, 'network', 'a', [message('same', 'Свежий текст', 2), { ...message('receipt', 'Сохранённое прочтение', 3), read: false },
    ...Array.from({ length: 98 }, (_, index) => message(`filler-${index}`, `Сообщение ${index}`, index + 4))]);
  await expect(page.getByText('Свежий текст')).toBeAttached();
  await complete(page, 'cache', 'a', [message('old', 'Старая история'), { ...message('same', 'Устаревший текст', 2), read: false }, message('receipt', 'Сохранённое прочтение', 3)]);
  await expect(page.getByText('Старая история')).toBeAttached();
  await expect(page.getByText('Свежий текст')).toBeAttached();
  await expect(page.getByText('Устаревший текст')).toHaveCount(0);
  expect((await state(page)).chats[0].messages.find(item => item.id === 'same').read).toBe(true);
  expect((await state(page)).chats[0].messages.find(item => item.id === 'receipt').read).toBe(true);
});

for (const first of ['cache', 'network']) {
  test(`an empty server history removes deleted messages when ${first} resolves first`, async ({ page }) => {
    await openChat(page);
    const deleted = message('deleted', 'Удалённое сообщение');
    const pending = { ...message('pending', 'Ожидающее сообщение', 1), isPending: true, isOptimistic: true };
    await page.evaluate(messages => window.__messengerTest.cache.seed(messages), [deleted, pending]);
    await complete(page, first, 'a', first === 'cache' ? [deleted, pending] : []);
    await complete(page, first === 'cache' ? 'network' : 'cache', 'a', first === 'cache' ? [] : [deleted, pending]);
    await expect(page.getByText('Удалённое сообщение')).toHaveCount(0);
    await expect(page.getByText('Ожидающее сообщение')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await window.__messengerTest.cache.read()).map(row => row.id))).toEqual(['pending']);
    await expect.poll(() => page.evaluate(async () => (await window.__messengerTest.cache.legacy()).map(row => row.id))).toEqual(['pending']);
    expect((await state(page)).status.a).toBe('loaded');
  });
}

test('an empty successful history clears both cache stores when there are no pending messages', async ({ page }) => {
  await openChat(page);
  const deleted = message('deleted', 'Удалённое сообщение');
  await page.evaluate(messages => window.__messengerTest.cache.seed(messages), [deleted]);
  await complete(page, 'cache', 'a', [deleted]);
  await complete(page, 'network', 'a');
  await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__messengerTest.cache.read())).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.__messengerTest.cache.legacy())).toEqual([]);
});

test('a server-confirmed optimistic message becomes delivered and can be removed on the next refresh', async ({ page }) => {
  await openChat(page);
  const optimistic = { ...message('confirmed', 'Локальный текст'), isPending: true, isOptimistic: true, isFailed: true };
  await complete(page, 'cache', 'a', [optimistic]);
  await complete(page, 'network', 'a', [message('confirmed', 'Серверная запись', 1)]);
  await expect.poll(async () => (await state(page)).chats[0].messages.map(({ isPending, isOptimistic, isFailed }) => ({ isPending, isOptimistic, isFailed })))
    .toEqual([{ isPending: false, isOptimistic: false, isFailed: false }]);
  await page.evaluate(() => { void window.__messengerTest.load('a'); });
  await complete(page, 'network', 'a');
  await expect(page.getByText('Локальный текст')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__messengerTest.cache.read())).toEqual([]);
});

test('older pagination uses the server cursor even when cached history starts earlier', async ({ page }) => {
  await openChat(page);
  const timestamp = '2026-10-06T12:00:00.123456Z';
  const row = number => ({ ...message(String(number).padStart(4, '0'), `Строка ${number}`), timestamp, createdAt: timestamp });
  await complete(page, 'cache', 'a', [row(30)]);
  await complete(page, 'network', 'a', Array.from({ length: 100 }, (_, index) => row(index + 100)));
  await expect.poll(async () => (await state(page)).chats[0].messages.length).toBe(101);
  await page.evaluate(() => { void window.__messengerTest.older('a'); });
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(3);
  expect(await page.evaluate(() => window.__messengerTest.requests[2].cursor)).toEqual({ id: '0100', timestamp });
  await complete(page, 'network', 'a', [row(90), row(91)]);
  await expect.poll(async () => (await state(page)).chats[0].messages.length).toBe(103);
  expect((await state(page)).chats[0].messages.slice(0, 3).map(row => row.id)).toEqual(['0030', '0090', '0091']);
});

test('offline cache pages do not move the server cursor or prevent retry after reconnecting', async ({ page, context }) => {
  await openChat(page);
  const timestamp = '2026-10-06T12:00:00.123456Z';
  const row = number => ({ ...message(String(number).padStart(4, '0'), `Строка ${number}`), timestamp, createdAt: timestamp });
  await complete(page, 'cache', 'a');
  await complete(page, 'network', 'a', Array.from({ length: 100 }, (_, index) => row(index + 100)));
  await expect.poll(async () => (await state(page)).status.a).toBe('loaded');
  await page.evaluate(messages => window.__messengerTest.cache.seed(messages), [row(30)]);
  await context.setOffline(true);
  expect(await page.evaluate(() => window.__messengerTest.older('a'))).toBe(1);
  expect(await page.evaluate(() => window.__messengerTest.older('a'))).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => { void window.__messengerTest.older('a'); });
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(3);
  expect(await page.evaluate(() => window.__messengerTest.requests[2].cursor)).toEqual({ id: '0100', timestamp });
  await complete(page, 'network', 'a', [row(90)]);
  await expect.poll(async () => (await state(page)).chats[0].messages.map(message => message.id)).toContain('0090');
});

test('older requests cannot end or overwrite a newer refresh', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => { void window.__messengerTest.load('a'); });
  await completeIndex(page, 1, [message('stale', 'Старый запрос')]);
  expect((await state(page)).syncing.a).toBe(true);
  await expect(page.getByText('Старый запрос')).toHaveCount(0);
  await page.evaluate(() => { void window.__messengerTest.load('a'); });
  await completeIndex(page, 3, [message('new', 'Последний запрос')]);
  await expect(page.getByText('Последний запрос')).toBeVisible();
  await completeIndex(page, 2, [message('stale', 'Устаревший ответ')]);
  await completeIndex(page, 0);
  await expect(page.getByText('Устаревший ответ')).toHaveCount(0);
  expect((await state(page)).status.a).toBe('loaded');
});

test('rapid chat changes invalidate old network and cache replies', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.__messengerTest.select('b'));
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(4);
  await page.evaluate(() => window.__messengerTest.select('a'));
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(6);
  await completeIndex(page, 1, [message('stale-a', 'Старый A')]);
  await completeIndex(page, 3, [message('stale-b', 'Старый B')]);
  expect((await state(page)).syncing.a).toBe(true);
  await completeIndex(page, 5, [message('new-a', 'Новый A')]);
  await completeIndex(page, 0, [message('stale-cache', 'Старый кэш')]);
  await completeIndex(page, 4);
  await expect(page.getByText('Новый A')).toBeVisible();
  await expect(page.getByText('Старый кэш')).toHaveCount(0);
  expect((await state(page)).chats[1].messages).toEqual([]);
});

test('a cache error does not stop the pending network request', async ({ page }) => {
  await openChat(page);
  await complete(page, 'cache', 'a', [], 'Fixture cache error');
  await expect(page.locator('.chat-skeleton-container')).toBeVisible();
  await complete(page, 'network', 'a', [message('network', 'История с сервера')]);
  await expect(page.getByText('История с сервера')).toBeVisible();
});

test('a refresh failure preserves the reading anchor in a cached history', async ({ page }) => {
  await openChat(page);
  await complete(page, 'cache', 'a', Array.from({ length: 100 }, (_, index) => message(`row-${index}`, `Строка ${index}\n` + 'Текст сообщения\n'.repeat(4), index)));
  const body = page.locator('.chat-body');
  await expect(page.locator('.message-row')).toHaveCount(100);
  await body.dispatchEvent('wheel', { deltaY: -1000 });
  await body.evaluate(node => { node.scrollTop = 1200; });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('coingram_chat_scroll_a') || '{}').scrollTop)).toBe(1200);
  const anchor = await body.evaluate(node => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll('.message-row')].find(row => row.getBoundingClientRect().bottom > top);
    return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - top };
  });
  await complete(page, 'network', 'a', [], 'Fixture refresh failure');
  await expect(page.getByRole('alert')).toBeAttached();
  await expect.poll(() => body.evaluate((node, anchor) => {
    const row = node.querySelector(`[data-message-id="${anchor.id}"]`);
    return Math.abs(row.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset);
  }, anchor)).toBeLessThanOrEqual(2);
});

test('a previous account cannot hydrate the current account', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => window.__messengerTest.user({ id: 'other-account', name: 'Другой пользователь' }));
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(4);
  await completeIndex(page, 0, [message('old-cache', 'Кэш другого аккаунта')]);
  await completeIndex(page, 1, [message('old-account', 'Ответ другого аккаунта')]);
  await completeIndex(page, 2);
  await completeIndex(page, 3);
  await expect(page.getByText('Здесь пока нет сообщений')).toBeVisible();
  await expect(page.getByText('Ответ другого аккаунта')).toHaveCount(0);
  await expect(page.getByText('Кэш другого аккаунта')).toHaveCount(0);
});
