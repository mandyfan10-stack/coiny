import { test, expect } from '@playwright/test';

const fixture = '/tests/ui/interface-fixture.html';
const themes = ['telegram-blue', 'emerald-green', 'sakura-pink', 'electric-purple', 'sunset-amber', 'rainbow-pearl'];
test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', reducedMotion: 'reduce' });

async function open(page, list = false) {
  await page.clock.setFixedTime(new Date('2026-10-08T10:30:00+03:00'));
  await page.goto(fixture + (list ? '?list' : ''));
  if (list) await expect(page.locator('.sidebar')).toBeVisible();
  else await expect(page.locator('.message-row')).toHaveCount(6);
}

test('chat chrome fits all target widths and short screens with 44px controls', async ({ page }) => {
  await open(page);
  for (const size of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 360 }, { width: 1024, height: 360 }, { width: 1920, height: 900 }]) {
    await page.setViewportSize(size);
    const metrics = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.chat-header-actions button, .chat-footer-input .input-row button')];
      const header = document.querySelector('.chat-header').getBoundingClientRect();
      const footer = document.querySelector('.chat-footer-input').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        buttons: buttons.map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right }; }),
        headerTop: header.top, footerBottom: footer.bottom };
    });
    expect(metrics.overflow).toBe(false);
    expect(metrics.headerTop).toBe(0);
    // WebKit rounds flex sizes to fractions of a CSS pixel.
    expect(metrics.footerBottom).toBeCloseTo(size.height, 1);
    for (const button of metrics.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(size.width);
    }
    const searchButton = page.getByRole('button', { name: 'Поиск в чате', exact: true });
    if (size.width <= 768) {
      await searchButton.hover();
      await expect(searchButton).toHaveCSS('color', await page.locator('.chat-header').evaluate(node => getComputedStyle(node).color));
    }
    await searchButton.click();
    await page.getByTestId('chat-search-input').fill('совпадений не существует');
    await expect(page.getByTestId('chat-search-counter')).toHaveText('Нет результатов');
    const bar = await page.getByTestId('chat-search-bar').boundingBox();
    expect(bar.x + bar.width).toBeLessThanOrEqual(size.width);
    await page.getByTestId('chat-search-input').press('Escape');
    await expect(page.getByTestId('chat-search-bar')).toHaveCount(0);
  }
});

test('classic mobile search opens, filters and returns keyboard focus on closing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, true);
  await expect(page.locator('[data-chat-id="saved"] .e2ee-sidebar-lock-icon')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Поиск чатов', exact: true });
  const menu = page.getByRole('button', { name: 'Настройки', exact: true });
  await menu.hover();
  await expect(menu).toHaveCSS('color', await page.locator('.sidebar-header').evaluate(node => getComputedStyle(node).color));
  const input = page.getByRole('searchbox', { name: 'Поиск чатов и сообщений', exact: true });
  await expect(input).toBeHidden();
  await trigger.click();
  await expect(input).toBeFocused();
  await input.fill('Олег');
  await expect(page.locator('[data-chat-id="oleg"]')).toBeVisible();
  await expect(page.locator('[data-chat-id="design"]')).toHaveCount(0);
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-chat-id="design"]')).toBeVisible();
  await page.getByRole('button', { name: 'Создать чат', exact: true }).click();
  await expect(page.locator('.new-chat-container')).toBeVisible();
});

test('chat rows support Enter and mobile Back returns to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, true);
  const row = page.locator('[data-chat-id="design"]');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-header-title')).toHaveText('Дизайн приложения');
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.evaluate(() => window.handleAndroidBackButton());
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.chat-area')).toBeHidden();
});

test('six flat palettes retain matching tails, readable text and custom wallpapers', async ({ page }) => {
  await open(page);
  for (const light of [false, true]) {
    const backgrounds = new Set();
    for (const theme of themes) {
      await page.evaluate(({ light, theme }) => { window.__interfaceTest.setDark(!light); window.__interfaceTest.setTheme(theme); }, { light, theme });
      await expect(page.locator('html')).toHaveClass(new RegExp('theme-' + theme));
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('theme-light'))).toBe(light);
      const metrics = await page.locator('[data-message-id="answer"] .message-bubble').evaluate(node => {
        const style = getComputedStyle(node);
        const time = getComputedStyle(node.querySelector('.message-time'));
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = value => rgb(value).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0);
        const contrast = (a, b) => { const l = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l[0] + .05) / (l[1] + .05); };
        return { background: style.backgroundColor, image: style.backgroundImage, tail: getComputedStyle(node, '::after').backgroundColor,
          textContrast: contrast(style.color, style.backgroundColor), timeContrast: contrast(time.color, style.backgroundColor),
          headerBackground: getComputedStyle(document.querySelector('.chat-header')).backgroundImage,
          sidebarBackground: getComputedStyle(document.querySelector('.sidebar')).backgroundImage };
      });
      backgrounds.add(metrics.background);
      expect(metrics.image).toBe('none');
      expect(metrics.headerBackground).toBe('none');
      expect(metrics.sidebarBackground).toBe('none');
      expect(metrics.tail).toBe(metrics.background);
      expect(metrics.textContrast).toBeGreaterThanOrEqual(4.5);
      expect(metrics.timeContrast).toBeGreaterThanOrEqual(4.5);
    }
    expect(backgrounds.size).toBe(6);
  }
  const wallpaper = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#dfe8e0"/></svg>').toString('base64');
  await page.evaluate(wallpaper => window.__interfaceTest.setUser(user => ({ ...user, wallpaper })), wallpaper);
  for (const theme of themes) {
    await page.evaluate(theme => window.__interfaceTest.setTheme(theme), theme);
    await expect(page.locator('html')).toHaveClass(new RegExp('theme-' + theme));
    await expect(page.locator('.chat-body')).toHaveClass(/has-custom-wallpaper/);
    await expect.poll(() => page.locator('.chat-body').evaluate(node => getComputedStyle(node).backgroundImage)).toContain(wallpaper);
  }
});

test('the extracted composer retains emoji caret insertion and Enter sending', async ({ page }) => {
  await open(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Привет, мир!');
  await input.evaluate(node => node.setSelectionRange(8, 8));
  await page.getByRole('button', { name: 'Смайлы, стикеры и GIF', exact: true }).click();
  await page.locator('.emoji-cell-btn').filter({ hasText: '😀' }).first().click();
  await expect(input).toHaveValue('Привет, 😀мир!');
  await page.keyboard.press('Escape');
  await input.press('Enter');
  await expect(page.locator('.message-row')).toHaveCount(7);
  await expect(page.locator('.message-row').last()).toContainText('Привет, 😀мир!');
  await expect(input).toHaveValue('');
});

for (const light of [false, true]) {
  test(`review screenshots — ${light ? 'light' : 'dark'}`, async ({ page }, testInfo) => {
    test.skip(!['desktop', 'mobile'].includes(testInfo.project.name), 'One Chromium reference set; WebKit is covered by behavior checks.');
    await page.addInitScript(light => localStorage.setItem('coingram-dark-mode', String(!light)), light);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page);
    await page.locator('[data-message-id="photo"] img').evaluate(image => image.decode());
    await page.locator('.chat-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const path = testInfo.outputPath(`interface-${testInfo.project.name}-${light ? 'light' : 'dark'}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach('Основной экран', { path, contentType: 'image/png' });
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await page.mouse.move(0, 0);
      const listPath = testInfo.outputPath(`interface-list-${light ? 'light' : 'dark'}.png`);
      await page.screenshot({ path: listPath, animations: 'disabled' });
      await testInfo.attach('Список чатов', { path: listPath, contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
  });
}
