import { expect } from '@playwright/test';

export const themes = ['telegram-blue', 'emerald-green', 'sakura-pink', 'electric-purple', 'sunset-amber', 'rainbow-pearl'];
export const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="#2481cc"/><circle cx="220" cy="55" r="25" fill="#ffd54f"/><path d="M0 180L90 70L165 150L210 105L300 180Z" fill="#166239"/></svg>');
export const video = '/tests/ui/assets/message-video.mp4';
export const audio = '/tests/ui/assets/message-voice.wav';
export function message(id, text = 'Сообщение', fields = {}) {
  return { id, text, senderId: 'messenger-self', timestamp: '2026-10-06T12:00:00Z', read: true, reactions: [], ...fields };
}

export function textSeries() {
  return ['peer', 'messenger-self'].flatMap((senderId, side) => ['first', 'middle', 'last'].map((position, index) => message(
    (side ? 'out-' : 'in-') + position,
    position === 'middle' ? 'Несколько строк текста\nИ ещё одна строка' : 'Текст сообщения',
    { senderId, timestamp: new Date(Date.UTC(2026, 9, 6, 12, side * 3 + index)).toISOString() }
  )));
}

export function mixedMessages() {
  return [
    message('short', 'А', { isPending: true }),
    message('incoming', 'Входящее сообщение', { senderId: 'peer' }),
    message('long', 'Длинное сообщение с переносами строк и одинаковыми отступами. '.repeat(12)),
    message('lines', 'Первая строка\nВторая строка\nПоследняя строка'),
    message('link', 'https://example.com/' + 'verylongpath'.repeat(16)),
    message('emoji', 'Привет 👋🙂'),
    message('failed', 'Не отправилось', { isFailed: true }),
    message('reply', 'Ответ с цитатой', { replyTo: 'incoming' }),
    message('code', '\x60\x60\x60const value = 42;\nconsole.log(value);\x60\x60\x60'),
    message('photo', 'Изображение', { media: image }),
    message('caption', 'Подпись к изображению. '.repeat(6), { media: image, replyTo: 'incoming' }),
    message('voice', 'Голосовое сообщение (0:01)', { media: audio }),
    message('video', 'Видео', { media: video }),
    message('video-caption', 'Подпись к видео', { media: video }),
    message('sticker', 'sticker:fixture', { media: image }),
    message('round', 'Видеосообщение', { media: video })
  ].map((item, index) => ({ ...item, timestamp: new Date(Date.UTC(2026, 9, 6, 12, index)).toISOString() }));
}

export async function loadMessages(page, messages) {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/tests/ui/messenger-fixture.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__messengerTest?.select));
  await page.evaluate(() => window.__messengerTest.select('a'));
  await expect.poll(() => page.evaluate(() => window.__messengerTest.requests.length)).toBe(2);
  await page.evaluate(messages => {
    window.__messengerTest.complete('cache', 'a');
    window.__messengerTest.complete('network', 'a', messages);
  }, messages);
  await expect(page.locator('.message-row')).toHaveCount(messages.length);
}

export function row(page, id) {
  return page.locator('[data-message-id="' + id + '"]');
}

export async function shape(bubble) {
  return bubble.evaluate(node => {
    const style = getComputedStyle(node);
    return {
      corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      clip: style.clipPath, webkitClip: style.webkitClipPath || 'none',
      padding: style.padding, font: style.fontSize, width: node.offsetWidth
    };
  });
}

export async function expectMetadataFits(bubble) {
  const result = await bubble.evaluate(node => {
    const bubbleBox = node.getBoundingClientRect();
    const metaBox = node.querySelector('.bubble-metadata').getBoundingClientRect();
    const text = node.querySelector('.message-text > span:not(.bubble-metadata-spacer)');
    const range = document.createRange();
    if (text) range.selectNodeContents(text);
    const overlaps = text ? [...range.getClientRects()].filter(rect =>
      Math.min(rect.right, metaBox.right) - Math.max(rect.left, metaBox.left) > 0.5 &&
      Math.min(rect.bottom, metaBox.bottom) - Math.max(rect.top, metaBox.top) > 0.5
    ).length : 0;
    return {
      fits: metaBox.left >= bubbleBox.left && metaBox.right <= bubbleBox.right + 0.5 &&
        metaBox.top >= bubbleBox.top && metaBox.bottom <= bubbleBox.bottom + 0.5,
      overlaps, scrollWidth: node.scrollWidth, width: node.clientWidth
    };
  });
  expect(result.fits).toBe(true);
  expect(result.overlaps).toBe(0);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width + 8);
}
