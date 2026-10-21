import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.routeWebSocket(/.*/, () => {}); });
const fixture = '/tests/ui/message-operations-fixture.html';

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
