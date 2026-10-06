import { test, expect } from '@playwright/test';

const fixture = '/tests/ui/messenger-fixture.html';
const message = (id, text, minute = 0) => ({ id, text, senderId: 'peer', timestamp: new Date(Date.UTC(2026, 9, 6, 12, minute)).toISOString(), read: true, reactions: [] });
const state = page => page.evaluate(() => window.__messengerTest.state);
const complete = (page, kind, id, messages = [], error = null) => page.evaluate(args => window.__messengerTest.complete(...args), [kind, id, messages, error]);
const completeIndex = (page, index, messages = []) => page.evaluate(args => window.__messengerTest.completeIndex(...args), [index, messages]);
async function openChat(page, id = 'a') {
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

test('cached messages stay visible during refresh, failure and retry', async ({ page }) => {
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
  await expect(page.getByText('Сохранённое сообщение')).toBeVisible();
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
  await complete(page, 'network', 'a', [message('same', 'Свежий текст', 2), { ...message('receipt', 'Сохранённое прочтение', 3), read: false }]);
  await expect(page.getByText('Свежий текст')).toBeVisible();
  await complete(page, 'cache', 'a', [message('old', 'Старая история'), { ...message('same', 'Устаревший текст', 2), read: false }, message('receipt', 'Сохранённое прочтение', 3)]);
  await expect(page.getByText('Старая история')).toBeVisible();
  await expect(page.getByText('Свежий текст')).toBeVisible();
  await expect(page.getByText('Устаревший текст')).toHaveCount(0);
  expect((await state(page)).chats[0].messages.find(item => item.id === 'same').read).toBe(true);
  expect((await state(page)).chats[0].messages.find(item => item.id === 'receipt').read).toBe(true);
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
  await body.evaluate(node => { node.scrollTop = 1200; });
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
