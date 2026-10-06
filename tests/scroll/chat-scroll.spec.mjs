import { test, expect } from '@playwright/test';

async function position(page) {
  return page.locator('.chat-body').evaluate(body => {
    const top = body.getBoundingClientRect().top;
    const row = [...body.querySelectorAll('.message-row')].find(item => item.getBoundingClientRect().bottom > top + 5);
    return {
      top: body.scrollTop,
      gap: body.scrollHeight - body.scrollTop - body.clientHeight,
      anchor: row?.dataset.messageId,
      offset: row?.getBoundingClientRect().top - top,
    };
  });
}

async function select(page, chatId) {
  await page.evaluate(id => window.__scrollTest.select(id), chatId);
  await expect(page.locator('.chat-header-name')).toHaveText(`Chat ${chatId}`);
}

async function readHistory(page, top) {
  await page.locator('.chat-body').dispatchEvent('wheel', { deltaY: -1000 });
  await page.locator('.chat-body').evaluate((body, nextTop) => { body.scrollTop = nextTop; }, top);
  await expect.poll(async () => Math.abs((await position(page)).top - top)).toBeLessThan(2);
  // Wait until the component has captured the anchor through its scroll handler.
  await expect.poll(() => page.evaluate(expectedTop => {
    const saved = JSON.parse(localStorage.getItem(`coingram_chat_scroll_${document.querySelector('.chat-header-name').textContent.at(-1)}`) || '{}');
    return typeof saved.scrollTop === 'number' ? Math.abs(saved.scrollTop - expectedTop) : Infinity;
  }, top)).toBeLessThan(2);
  return position(page);
}

async function expectAnchor(page, saved) {
  const row = page.locator(`.message-row[data-message-id="${saved.anchor}"]`);
  await expect(row).toHaveCount(1);
  // A prepend can reveal an older row above the saved message. What matters
  // is that the message the user was reading stays at the same screen offset.
  await expect.poll(() => row.evaluate((element, offset) => {
    const body = element.closest('.chat-body');
    return Math.abs(element.getBoundingClientRect().top - body.getBoundingClientRect().top - offset);
  }, saved.offset)).toBeLessThan(2);
}

async function pending(page, chatId, count = 1) {
  await expect.poll(() => page.evaluate(id => window.__scrollTest.requests.filter(item => item.chatId === id).length, chatId)).toBe(count);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/scroll/fixture.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.message-row')).toHaveCount(200);
  await expect.poll(async () => (await position(page)).gap).toBeLessThan(2);
});

test('long histories open at the newest message and restore the reading anchor', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  for (let iteration = 0; iteration < 5; iteration++) {
    await select(page, 'b');
    await expect.poll(async () => (await position(page)).gap).toBeLessThan(2);
    await select(page, 'a');
    await expectAnchor(page, saved);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.message-row')).toHaveCount(200);
  await expectAnchor(page, saved);
});

test('saved reading position takes priority over newly unread messages', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  await select(page, 'b');
  await page.evaluate(() => window.__scrollTest.setUnread('a', 3));
  await select(page, 'a');
  await expectAnchor(page, saved);
});

test('a reading position near the bottom survives leaving the chat', async ({ page }) => {
  const before = await position(page);
  const saved = await readHistory(page, before.top - 40);
  await select(page, 'b');
  await select(page, 'a');
  await expectAnchor(page, saved);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectAnchor(page, saved);
});

test('leaving before the scroll event saves the actual final position', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  await page.evaluate(() => window.__scrollTest.leaveAt(8400));
  await expect(page.locator('.chat-body')).toHaveCount(0);
  await select(page, 'a');
  await expectAnchor(page, { ...saved, offset: saved.offset - 400 });
});

test('reopening recent history loads older pages until the saved message is available', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  const pages = Math.ceil((150 - Number(saved.anchor.replace('a-msg-', ''))) / 30);
  await page.goto('/tests/scroll/fixture.html?recent=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.message-row')).toHaveCount(50);
  for (let count = 1; count <= pages; count++) {
    await pending(page, 'a', count);
    await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  }
  await expectAnchor(page, saved);
  await page.waitForTimeout(100);
  // Restoration must stop paging once the anchor becomes available.
  await pending(page, 'a', pages);
});

test('an unavailable history page retains the saved anchor for the next visit', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  await page.goto('/tests/scroll/fixture.html?recent=1', { waitUntil: 'domcontentloaded' });
  await pending(page, 'a');
  await page.evaluate(() => window.__scrollTest.failNext('a'));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.coingram_chat_scroll_a).topMessageId)).toBe(saved.anchor);
  await pending(page, 'a');
  await select(page, 'b');
  await select(page, 'a');
  const pages = Math.ceil((150 - Number(saved.anchor.replace('a-msg-', ''))) / 30);
  for (let count = 2; count <= pages + 1; count++) {
    await pending(page, 'a', count);
    await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  }
  await expectAnchor(page, saved);
});

test('a deleted saved message restores the adjacent place in history', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  const index = Number(saved.anchor.replace('a-msg-', ''));
  await page.goto(`/tests/scroll/fixture.html?recent=1&missing=${saved.anchor}`, { waitUntil: 'domcontentloaded' });
  const pages = Math.ceil((151 - index) / 30);
  for (let count = 1; count <= pages; count++) {
    await pending(page, 'a', count);
    await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  }
  await expectAnchor(page, { ...saved, anchor: `a-msg-${index + 1}` });
  await page.waitForTimeout(100);
  await pending(page, 'a', pages);
});

test('a late restore page cannot move another chat or erase the saved anchor', async ({ page }) => {
  const savedA = await readHistory(page, 8000);
  await page.goto('/tests/scroll/fixture.html?recent=1', { waitUntil: 'domcontentloaded' });
  await pending(page, 'a');
  await select(page, 'b');
  const savedB = await readHistory(page, 4000);
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await expectAnchor(page, savedB);
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.coingram_chat_scroll_a).topMessageId)).toBe(savedA.anchor);
  await pending(page, 'a');
});

test('manual reading during restoration takes priority over the old saved anchor', async ({ page }) => {
  await readHistory(page, 8000);
  await page.goto('/tests/scroll/fixture.html?recent=1', { waitUntil: 'domcontentloaded' });
  await pending(page, 'a');
  const saved = await readHistory(page, 2000);
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await expectAnchor(page, saved);
  await page.waitForTimeout(100);
  await pending(page, 'a');
  await select(page, 'b');
  await select(page, 'a');
  await expectAnchor(page, saved);
});

test('row growth and viewport resizing keep the latest message visible', async ({ page }) => {
  await page.evaluate(() => window.__scrollTest.expand('a', 'a-msg-199'));
  await expect.poll(async () => (await position(page)).gap).toBeLessThan(2);
  const viewport = page.viewportSize();
  await page.setViewportSize({ ...viewport, height: viewport.height - 240 });
  await expect.poll(async () => (await position(page)).gap).toBeLessThan(2);
});

test('an image decoding later keeps the latest message visible', async ({ page }) => {
  let releaseImage;
  const imageReady = new Promise(resolve => { releaseImage = resolve; });
  await page.route('**/scroll-image.svg', async route => {
    await imageReady;
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="450"><rect width="400" height="450" fill="blue"/></svg>',
    });
  });
  await page.evaluate(() => window.__scrollTest.attachImage('a', 'a-msg-199'));
  const image = page.locator('.message-row[data-message-id="a-msg-199"] img.bubble-media');
  await expect(image).toHaveCount(1);
  releaseImage();
  await expect.poll(() => image.evaluate(element => element.naturalHeight)).toBe(450);
  await expect.poll(async () => (await position(page)).gap).toBeLessThan(2);
});

test('row growth and incoming messages preserve the position while reading history', async ({ page }) => {
  const saved = await readHistory(page, 8000);
  await page.evaluate(() => {
    window.__scrollTest.expand('a', 'a-msg-0');
    window.__scrollTest.append('a');
  });
  await expect(page.locator('.message-row')).toHaveCount(201);
  await expectAnchor(page, saved);
});

test('keyboard navigation releases the bottom pin while reading older messages', async ({ page }) => {
  const before = await position(page);
  await page.locator('.chat-body').focus();
  await page.keyboard.press('PageUp');
  await expect.poll(async () => (await position(page)).top).toBeLessThan(before.top - 100);
  // Native keyboard scrolling is animated; wait for the browser to settle.
  await page.waitForTimeout(350);
  const saved = await position(page);
  await page.evaluate(() => window.__scrollTest.append('a'));
  await expectAnchor(page, saved);
});

test('a small first upward scroll does not reattach the bottom pin', async ({ page }) => {
  const before = await position(page);
  await readHistory(page, before.top - 5);
  // Continue the same gesture without another input event. Native keyboard
  // and wheel animations often begin with a frame only a few pixels away.
  const nextTop = before.top - 400;
  await page.locator('.chat-body').evaluate((body, top) => { body.scrollTop = top; }, nextTop);
  await page.waitForFunction(top => {
    const saved = JSON.parse(localStorage.getItem('coingram_chat_scroll_a') || '{}');
    return Math.abs(saved.scrollTop - top) < 2;
  }, nextTop);
  const saved = await position(page);
  await page.evaluate(() => window.__scrollTest.append('a'));
  await expectAnchor(page, saved);
});

test('prepending older history preserves the current anchor', async ({ page }) => {
  const saved = await readHistory(page, 1);
  await pending(page, 'a');
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await expect(page.locator('.message-row')).toHaveCount(230);
  await expectAnchor(page, saved);
});

test('reading a different message while history loads preserves the new position', async ({ page }) => {
  await readHistory(page, 1);
  await pending(page, 'a');
  const saved = await readHistory(page, 4000);
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await expect(page.locator('.message-row')).toHaveCount(230);
  await expectAnchor(page, saved);
});

test('late history from a previous chat cannot move the current chat', async ({ page }) => {
  await select(page, 'b');
  const saved = await readHistory(page, 4000);
  await select(page, 'a');
  await readHistory(page, 1);
  await pending(page, 'a');
  await select(page, 'b');
  await expectAnchor(page, saved);
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await expectAnchor(page, saved);
  await page.waitForTimeout(150);
  await expectAnchor(page, saved);
});

test('returning to the same chat does not revive an obsolete history request', async ({ page }) => {
  await readHistory(page, 1);
  await pending(page, 'a');
  const saved = await readHistory(page, 8000);
  await select(page, 'b');
  await select(page, 'a');
  await expectAnchor(page, saved);
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await expect(page.locator('.message-row')).toHaveCount(230);
  await expectAnchor(page, saved);
});

test('a late response does not release another chat’s history request', async ({ page }) => {
  await readHistory(page, 1);
  await pending(page, 'a');
  await select(page, 'b');
  const saved = await readHistory(page, 1);
  await pending(page, 'b');
  await page.evaluate(() => window.__scrollTest.resolveNext('a'));
  await page.locator('.chat-body').evaluate(body => { body.scrollTop = 2; });
  await page.waitForTimeout(100);
  await pending(page, 'b');
  await page.evaluate(() => window.__scrollTest.resolveNext('b'));
  await expect(page.locator('.message-row')).toHaveCount(150);
  await expectAnchor(page, { ...saved, offset: saved.offset - 1 });
});
