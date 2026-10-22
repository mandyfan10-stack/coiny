import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.routeWebSocket(/.*/, () => {}); });
const fixture = '/tests/ui/message-operations-fixture.html';

for (const existing of [true, false]) {
  test(`real AuthProvider and ChatProvider send an encrypted story reply via ${existing ? 'an existing' : 'a new'} personal chat`, async ({ page }) => {
    await page.goto('/tests/ui/account-isolation-fixture.html?story=1');
    await expect(page.getByTestId('owner')).toHaveText('signed-out');
    await page.evaluate(() => window.__accountIsolation.login('story-owner', 'fixture-password'));
    await expect(page.getByTestId('owner')).toHaveText('story-owner');
    await expect.poll(() => page.evaluate(() => window.__accountIsolation.requests.some(row => row.kind === 'chats'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__accountIsolation.chat.stories.some(story => story.id === 'peer-story'))).toBe(true);
    await page.evaluate(existing => {
      const control = window.__accountIsolation;
      const group = { id: 'source', type: 'group', name: 'Группа', members: [], messages: [] };
      const peer = { id: 'story-peer', publicKey: control.storyKeys.peerPublic, hasE2ee: true };
      const personal = { id: 'story-private', type: 'personal', members: [{ id: 'story-owner' }, peer], messages: [] };
      control.complete(0, existing ? [group, personal] : [group]);
      control.holdSend = true;
    }, existing);
    await expect.poll(() => page.evaluate(() => window.__accountIsolation.chat.chats.some(chat => chat.id === 'source'))).toBe(true);
    await page.evaluate(() => window.__accountIsolation.chat.setActiveChatId('source'));
    await page.getByRole('button', { name: 'Открыть историю', exact: true }).click();
    const reply = page.getByRole('textbox', { name: 'Ответить на историю', exact: true });
    await reply.fill('Проверка настоящего контекста');
    await reply.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__accountIsolation.sent.length)).toBe(1);
    await expect(page.getByPlaceholder('Ответ отправлен!')).toHaveCount(0);
    const sent = await page.evaluate(async () => {
      const control = window.__accountIsolation;
      const { importPublicKey, deriveSymmetricKey, decryptMessage } = await import('/src/utils/e2eeHelper.js');
      const key = await deriveSymmetricKey(control.storyKeys.peer.privateKey, await importPublicKey(control.storyKeys.ownerPublic));
      const row = control.sent[0];
      const [body, iv] = row.text.slice('e2ee:aes-gcm:'.length).split(':');
      return { chatId: row.chatId, senderId: row.senderId, replyTo: row.replyTo,
        text: await decryptMessage(body, iv, key), created: control.created,
        active: control.chat.activeChatId, sourceMessages: control.chat.chats.find(chat => chat.id === 'source').messages.length };
    });
    expect(sent).toEqual({ chatId: 'story-private', senderId: 'story-owner', replyTo: null,
      text: 'Ответ на историю: Проверка настоящего контекста', created: existing ? [] : ['story-peer'], active: 'source', sourceMessages: 0 });
    await page.evaluate(() => window.__accountIsolation.confirmSend());
    await expect(page.getByPlaceholder('Ответ отправлен!')).toBeVisible();
  });
}

for (const existing of [true, false]) {
  test(`story reply reaches its author with ${existing ? 'an existing' : 'a newly created'} personal chat while another group is active`, async ({ page }) => {
    await page.goto(fixture);
    const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await composer.fill('Черновик группы');
    await page.evaluate(existing => window.__messageOperations.openStory(existing), existing);
    const reply = page.getByRole('textbox', { name: 'Ответить на историю', exact: true });
    await reply.fill('Привет из истории');
    await reply.press('Enter');
    await expect(page.getByPlaceholder('Ответ отправлен!')).toBeVisible();
    const result = await page.evaluate(async () => {
      const control = window.__messageOperations;
      const { decryptMessage } = await import('/src/utils/e2eeHelper.js');
      const sent = control.requests.find(request => request.kind === 'send');
      const [ciphertext, iv] = sent.text.slice('e2ee:aes-gcm:'.length).split(':');
      return { chatId: sent.chatId, replyTo: sent.replyTo, text: await decryptMessage(ciphertext, iv, control.storyKey),
        creates: control.requests.filter(request => request.kind === 'create').length,
        sourceMessages: control.chats.find(chat => chat.id === 'source').messages.length };
    });
    expect(result).toEqual({ chatId: 'story-private', replyTo: null, text: 'Ответ на историю: Привет из истории', creates: existing ? 0 : 1, sourceMessages: 3 });
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(composer).toHaveValue('Черновик группы');
  });
}

test('story reply retains text on failure and retries without a false success', async ({ page }) => {
  await page.goto(fixture);
  await page.evaluate(async () => { await window.__messageOperations.openStory(); window.__messageOperations.failSend = true; });
  const reply = page.getByRole('textbox', { name: 'Ответить на историю', exact: true });
  await reply.fill('Не потерять ответ'); await reply.press('Enter');
  await expect(reply).toHaveValue('Не потерять ответ');
  await expect(page.getByRole('alert')).toContainText('Не удалось отправить');
  await expect(page.getByPlaceholder('Ответ отправлен!')).toHaveCount(0);
  await page.evaluate(() => { window.__messageOperations.failSend = false; });
  await reply.press('Enter');
  await expect(page.getByPlaceholder('Ответ отправлен!')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__messageOperations.chats.find(chat => chat.id === 'story-private').messages.length)).toBe(1);
  await expect(reply).toBeEnabled({ timeout: 5000 });
});

for (const offline of [true, false]) {
  test(`story reply needs server confirmation when ${offline ? 'already offline' : 'the request loses its connection'}`, async ({ page }) => {
    await page.goto(fixture);
    await page.evaluate(async offline => {
      await window.__messageOperations.openStory();
      if (offline) Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      else window.__messageOperations.failNetwork = true;
    }, offline);
    const reply = page.getByRole('textbox', { name: 'Ответить на историю', exact: true });
    await reply.fill('Ответ после восстановления сети');
    await reply.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Не удалось отправить');
    await expect(reply).toHaveValue('Ответ после восстановления сети');
    await expect(page.getByPlaceholder('Ответ отправлен!')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__messageOperations.chats.find(chat => chat.id === 'story-private').messages.length)).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.__messageOperations.failNetwork = false;
    });
    await reply.press('Enter');
    await expect(page.getByPlaceholder('Ответ отправлен!')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__messageOperations.chats.find(chat => chat.id === 'story-private').messages.length)).toBe(1);
  });
}
