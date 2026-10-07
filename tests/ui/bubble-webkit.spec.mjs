import { test, expect } from '@playwright/test';
import { themes, message, textSeries, mixedMessages, loadMessages, row, shape, expectMetadataFits } from './message-layout-helpers.mjs';

for (const legacyPreference of [null, 'true', 'false']) {
  test('stable Telegram corners ignore legacy preference ' + legacyPreference, async ({ page }) => {
    if (legacyPreference !== null) await page.addInitScript(value => localStorage.setItem('coiny_custom_bubble_geometry', value), legacyPreference);
    if (legacyPreference === 'false') await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', item => { if (/Unsupported style property|Invalid value.*clip/i.test(item.text())) errors.push(item.text()); });
    await loadMessages(page, textSeries());
    const corners = {
      'in-first': ['16px', '16px', '16px', '6px'], 'in-middle': ['6px', '16px', '16px', '6px'], 'in-last': ['6px', '16px', '16px', '4px'],
      'out-first': ['16px', '16px', '6px', '16px'], 'out-middle': ['16px', '6px', '6px', '16px'], 'out-last': ['16px', '6px', '4px', '16px']
    };
    for (const [id, expected] of Object.entries(corners)) {
      const bubble = row(page, id).locator('.message-bubble');
      const initial = await shape(bubble);
      expect(initial.corners).toEqual(expected);
      expect(initial.clip).toBe('none');
      expect(initial.webkitClip).toBe('none');
      await bubble.hover();
      expect(await shape(bubble)).toEqual(initial);
      await bubble.dispatchEvent('pointerdown', { pointerType: 'mouse', clientX: 1, clientY: 1 });
      expect((await shape(bubble)).corners).toEqual(expected);
      await bubble.dispatchEvent('pointercancel', { pointerType: 'mouse' });
      expect(await bubble.evaluate(node => getComputedStyle(node, '::after').content)).toBe(id.endsWith('last') ? '""' : 'none');
    }
    expect(errors).toEqual([]);
  });
}

test('a date divider separates messages and repeats the group sender header', async ({ page }) => {
  await loadMessages(page, [message('day-a'), message('day-b')]);
  await page.evaluate(() => window.__messengerTest.replaceMessages('a', [
    { id: 'day-a', text: 'До полуночи', senderId: 'peer', timestamp: new Date(2026, 9, 6, 23, 59).toISOString() },
    { id: 'day-b', text: 'После полуночи', senderId: 'peer', timestamp: new Date(2026, 9, 7, 0, 1).toISOString() }
  ]));
  await expect(page.locator('.chat-date-divider')).toHaveCount(2);
  for (const id of ['day-a', 'day-b']) {
    await expect(row(page, id)).toHaveClass(/group-first.*group-last/);
    await expect(row(page, id).locator('.sender-name')).toHaveCount(1);
    expect((await shape(row(page, id).locator('.message-bubble'))).corners).toEqual(['16px', '16px', '16px', '4px']);
  }
});

for (const locale of ['ru-RU', 'en-US']) {
  test('text and caption metadata never overlap in ' + locale, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    try {
      await loadMessages(page, mixedMessages());
      for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 800 }, { width: 1024, height: 800 }, { width: 1920, height: 900 }, { width: 640, height: 360 }]) {
        await page.setViewportSize(size);
        for (const id of ['short', 'incoming', 'long', 'lines', 'link', 'emoji', 'failed', 'reply', 'code', 'caption', 'voice', 'video-caption']) {
          const bubble = row(page, id).locator('.message-bubble');
          await bubble.scrollIntoViewIfNeeded();
          await expectMetadataFits(bubble);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.chat-body').scrollWidth <= document.querySelector('.chat-body').clientWidth)).toBe(true);
      }
      const bubble = row(page, 'short').locator('.message-bubble');
      await bubble.scrollIntoViewIfNeeded();
      const initial = await shape(bubble);
      await page.evaluate(() => window.__messengerTest.replaceMessages('a', window.__messengerTest.state.chats.find(chat => chat.id === 'a').messages.map(msg => msg.id === 'short' ? { ...msg, isPending: false, read: true } : msg)));
      await expect(row(page, 'short').locator('.pending')).toHaveCount(0);
      expect(await shape(bubble)).toEqual(initial);
    } finally {
      await context.close();
    }
  });
}

test('all six themes retain matching tails and whole media cards', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadMessages(page, mixedMessages());
  await expect.poll(() => row(page, 'photo').locator('img').evaluate(img => img.naturalWidth)).toBe(300);
  for (const light of [false, true]) {
    for (const theme of themes) {
      await page.evaluate(({ theme, light, themes }) => {
        document.documentElement.classList.remove('theme-light', ...themes.map(name => 'theme-' + name));
        document.documentElement.classList.add('theme-' + theme);
        if (light) document.documentElement.classList.add('theme-light');
      }, { theme, light, themes });
      const bubble = row(page, 'caption').locator('.message-bubble');
      await bubble.scrollIntoViewIfNeeded();
      const result = await bubble.evaluate(node => {
        const parent = getComputedStyle(node);
        const media = getComputedStyle(node.querySelector('.bubble-media-wrapper'));
        return { top: [parent.borderTopLeftRadius, parent.borderTopRightRadius], mediaTop: [media.borderTopLeftRadius, media.borderTopRightRadius], mediaBottom: [media.borderBottomLeftRadius, media.borderBottomRightRadius], clip: parent.clipPath, overflow: parent.overflow };
      });
      expect(result.top).toEqual(result.mediaTop);
      expect(result.mediaBottom).toEqual(['0px', '0px']);
      expect(result.clip).toBe('none');
      expect(result.overflow).toBe('visible');
      await expectMetadataFits(bubble);
      for (const id of ['sticker', 'round', 'photo']) {
        const transparent = row(page, id).locator('.message-bubble');
        await expect(transparent).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        if (id !== 'photo') {
          await expect(transparent).toHaveCSS('box-shadow', 'none');
          await expect(transparent).toHaveCSS('border-top-width', '0px');
        }
      }
      for (const side of ['peer', 'messenger-self']) {
        await page.evaluate(senderId => window.__messengerTest.replaceMessages('a', [...window.__messengerTest.state.chats.find(chat => chat.id === 'a').messages.filter(msg => msg.id !== 'tail'), { id: 'tail', text: 'Хвост выбранной темы', senderId, timestamp: '2026-10-06T13:00:00Z' }]), side);
        const tail = row(page, 'tail').locator('.message-bubble');
        await tail.scrollIntoViewIfNeeded();
        const appearance = await tail.evaluate((node, side) => {
          const box = node.getBoundingClientRect();
          const rowBox = node.closest('.message-row').getBoundingClientRect();
          const style = getComputedStyle(node, '::after');
          const probe = document.createElement('span');
          probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(side === 'peer' ? '--bubble-tail-other' : '--bubble-tail-me');
          document.body.appendChild(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return { color, actual: style.backgroundColor, mask: style.maskImage || style.webkitMaskImage, fits: side === 'peer' ? box.left - 7 >= rowBox.left : box.right + 7 <= rowBox.right };
        }, side);
        expect(appearance.actual).toBe(appearance.color);
        expect(appearance.mask).toContain('data:image/svg+xml');
        expect(appearance.fits).toBe(true);
      }
      if (theme === 'telegram-blue' || theme === 'rainbow-pearl') await page.screenshot({ path: testInfo.outputPath(theme + (light ? '-light.png' : '-dark.png')), animations: 'disabled' });
    }
  }
});

test('reaction rows wrap without changing corners or covering metadata', async ({ page }) => {
  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🤔'];
  await page.setViewportSize({ width: 320, height: 740 });
  await loadMessages(page, [message('reactions', 'Сообщение с реакциями')]);
  const bubble = row(page, 'reactions').locator('.message-bubble');
  const before = await shape(bubble);
  const height = (await bubble.boundingBox()).height;
  await page.evaluate(emojis => window.__messengerTest.replaceMessages('a', [{ ...window.__messengerTest.state.chats.find(chat => chat.id === 'a').messages[0], reactions: emojis.map(emoji => ({ emoji, count: 123, users: ['messenger-self'] })) }]), emojis);
  await expect(row(page, 'reactions').locator('.reaction-badge')).toHaveCount(8);
  expect((await shape(bubble)).corners).toEqual(before.corners);
  const reactions = await row(page, 'reactions').locator('.bubble-reactions').boundingBox();
  const badge = await row(page, 'reactions').locator('.reaction-badge').first().boundingBox();
  expect(reactions.height).toBeGreaterThan(badge.height);
  expect((await bubble.boundingBox()).height).toBeGreaterThan(height);
  await expectMetadataFits(bubble);
  await row(page, 'reactions').locator('.reaction-badge').first().click();
  await expect(row(page, 'reactions').locator('.reaction-badge')).toHaveCount(7);
  expect((await shape(bubble)).corners).toEqual(before.corners);
});

test('RTL text and compact video controls remain inside the shared bubble layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await loadMessages(page, [
    ...mixedMessages(),
    message('rtl', 'مرحبا هذا نص طويل لاختبار الرسالة '.repeat(6), { timestamp: '2026-10-06T13:00:00Z' })
  ]);
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const rtl = row(page, 'rtl').locator('.message-bubble');
  await rtl.scrollIntoViewIfNeeded();
  await expectMetadataFits(rtl);
  await expect(rtl.locator('.message-text > span[dir="auto"]')).toHaveCSS('direction', 'rtl');
  for (const id of ['video', 'video-caption']) {
    const bubble = row(page, id).locator('.message-bubble');
    await bubble.scrollIntoViewIfNeeded();
    await expect(bubble.locator('.regular-video-wrapper')).toHaveCSS('border-radius', '0px');
    expect(await bubble.locator('.regular-video-controls').evaluate(node => {
      const box = node.getBoundingClientRect();
      return [...node.children].every(child => {
        const rect = child.getBoundingClientRect();
        return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
      });
    })).toBe(true);
  }
});

test('updates and reactions preserve the message being read', async ({ page }) => {
  await loadMessages(page, Array.from({ length: 90 }, (_, index) => message('history-' + index, 'Сообщение истории ' + index + '. ' + 'Несколько строк текста. '.repeat(5), { senderId: 'peer', timestamp: new Date(Date.UTC(2026, 9, 6, 10, index)).toISOString() })));
  const target = row(page, 'history-40');
  await page.locator('.chat-body').dispatchEvent('wheel', { deltaY: -1000 });
  await target.evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('coingram_chat_scroll_a') || '{}');
    return Math.abs((saved.scrollTop ?? -10000) - document.querySelector('.chat-body').scrollTop);
  })).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await target.boundingBox()).y - (await page.locator('.chat-body').boundingBox()).y)).toBeLessThanOrEqual(2);
  const before = (await target.boundingBox()).y;
  // A changed row above the viewport must move the scroll offset, not the
  // message being read. Updating only that message would miss this regression.
  await page.evaluate(() => window.__messengerTest.replaceMessages('a', window.__messengerTest.state.chats.find(chat => chat.id === 'a').messages.map(msg => msg.id === 'history-39' ? { ...msg, reactions: [{ emoji: '👍', count: 1, users: ['messenger-self'] }] } : msg)));
  await expect(row(page, 'history-39').locator('.reaction-badge')).toHaveCount(1);
  await expect.poll(async () => Math.abs((await target.boundingBox()).y - before)).toBeLessThanOrEqual(2);
  await page.evaluate(() => window.__messengerTest.replaceMessages('a', window.__messengerTest.state.chats.find(chat => chat.id === 'a').messages.map(msg => msg.id === 'history-39' ? { ...msg, reactions: [] } : msg)));
  await expect(row(page, 'history-39').locator('.reaction-badge')).toHaveCount(0);
  await expect.poll(async () => Math.abs((await target.boundingBox()).y - before)).toBeLessThanOrEqual(2);
  await page.evaluate(() => window.__messengerTest.replaceMessages('a', window.__messengerTest.state.chats.find(chat => chat.id === 'a').messages.map(msg => msg.id === 'history-40' ? { ...msg, reactions: [{ emoji: '👍', count: 1, users: ['messenger-self'] }] } : msg)));
  await expect(target.locator('.reaction-badge')).toBeVisible();
  await expect.poll(async () => Math.abs((await target.boundingBox()).y - before)).toBeLessThanOrEqual(2);
  await target.locator('.reaction-badge').click();
  await expect(target.locator('.reaction-badge')).toHaveCount(0);
  await expect.poll(async () => Math.abs((await target.boundingBox()).y - before)).toBeLessThanOrEqual(2);
});
