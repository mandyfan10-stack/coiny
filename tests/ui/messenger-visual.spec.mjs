import { test, expect } from '@playwright/test';

const fixture = '/tests/ui/messenger-fixture.html?dialogs';
async function openPicker(page) {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Смайлы', exact: true }).click();
  await expect(page.locator('.media-picker-panel')).toBeVisible();
}
async function expectPanelInside(page, top = 0, bottom = null) {
  await expect.poll(async () => {
    const bounds = await page.locator('.media-picker-panel').boundingBox();
    return bounds.y >= top - 1 && bounds.y + bounds.height <= (bottom ?? page.viewportSize().height) + 1
      && bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1;
  }, { message: 'Picker settles fully inside the visible viewport' }).toBe(true);
  const bounds = await page.locator('.media-picker-panel').boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(top - 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual((bottom ?? page.viewportSize().height) + 1);
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  const tabs = await page.locator('.picker-top-tabs').boundingBox();
  expect(tabs.y).toBeGreaterThanOrEqual(top - 1);
  expect(tabs.height).toBeGreaterThanOrEqual(30);
}

test('modal search icon has a stable text gutter in all creation forms', async ({ page }) => {
  for (const size of [{ width: 320, height: 640 }, { width: 390, height: 360 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await page.goto(fixture);
    for (const label of ['Личный чат', 'Группа', 'Канал']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const input = page.locator('.new-chat-container .modal-search input');
      await input.fill('Тестовый поиск');
      const metrics = await input.evaluate(node => {
        const icon = node.parentElement.querySelector('.search-icon').getBoundingClientRect();
        const style = getComputedStyle(node);
        return { padding: parseFloat(style.paddingLeft), textLeft: node.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), iconRight: icon.right };
      });
      expect(metrics.padding).toBe(38);
      expect(metrics.textLeft - metrics.iconRight).toBeGreaterThanOrEqual(7);
      await expect(input).toHaveValue('Тестовый поиск');
      await page.locator('.new-chat-container .settings-close-btn').click();
    }
  }
});

test('picker fits phone, landscape, tablet and short desktop screens', async ({ page }) => {
  await page.route('**/tenor.googleapis.com/**', route => route.fulfill({ json: { results: [], next: '' } }));
  for (const size of [{ width: 320, height: 640 }, { width: 390, height: 360 }, { width: 640, height: 360 }, { width: 768, height: 360 }, { width: 1024, height: 360 }]) {
    await page.setViewportSize(size);
    await openPicker(page);
    await expectPanelInside(page);
    for (const label of ['Стикеры', 'GIF', 'Смайлы']) {
      await page.locator('.picker-top-tabs').getByRole('button', { name: label, exact: true }).click();
      await expectPanelInside(page);
      await expect(page.locator('.picker-search-input')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.media-picker-panel')).toHaveCount(0);
    await expect(page.locator('.emoji-trigger')).toBeFocused();
  }
});

test('picker follows the visual viewport when keyboard opens and pans', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 844, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.__testViewport = viewport;
  });
  await openPicker(page);
  await page.locator('.picker-search-input').fill('кот');
  await page.evaluate(() => { window.__testViewport.height = 300; window.__testViewport.offsetTop = 40; window.__testViewport.dispatchEvent(new Event('resize')); });
  await expect.poll(() => page.locator('.media-picker-panel').evaluate(node => Math.round(node.getBoundingClientRect().bottom))).toBe(340);
  await expectPanelInside(page, 40, 340);
  await expect(page.locator('.picker-search-input')).toHaveValue('кот');
  await page.evaluate(() => { window.__testViewport.offsetTop = 80; window.__testViewport.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('.media-picker-panel').evaluate(node => Math.round(node.getBoundingClientRect().bottom))).toBe(380);
  await expectPanelInside(page, 80, 380);
});

for (const reason of ['missing', 'blocked']) {
  test(`story gallery stays clickable when camera is ${reason}`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.addInitScript(reason => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: reason === 'missing' ? undefined : { getUserMedia: async () => { throw new DOMException('Fixture camera denied', 'NotAllowedError'); } } });
    }, reason);
    await page.goto(fixture);
    await page.getByRole('button', { name: 'История', exact: true }).click();
    const gallery = page.getByRole('button', { name: 'Выбрать из галереи' });
    await expect(gallery).toBeVisible();
    await expect(page.locator('.story-studio-bottom-toolbar')).toHaveCount(0);
    const chooserPromise = page.waitForEvent('filechooser');
    await gallery.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') });
    await expect(page.locator('.story-editor-media')).toBeVisible();
  });
}

test('story camera controls remain available when camera works', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => new MediaStream() } }));
  await page.goto(fixture);
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сделать снимок' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Переключить камеру' })).toBeVisible();
  await expect(page.locator('.story-toolbar-btn.gallery')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать из галереи' })).toHaveCount(0);
});
