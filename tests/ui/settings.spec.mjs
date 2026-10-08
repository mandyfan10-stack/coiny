import { test, expect } from '@playwright/test';

const sections = ['profile', 'appearance', 'notifications', 'stickers', 'security', 'storage'];
const dialog = page => page.locator('.settings-dialog');
const requestFields = page => page.evaluate(() => window.__settingsTest.requests.map(({ kind, fields }) => ({ kind, fields })));
const resolve = (page, index, error = null) => page.evaluate(({ index, error }) => window.__settingsTest.resolve(index, error), { index, error });
const open = async (page, section) => {
  await page.evaluate(section => window.__settingsTest.open(section), section);
  await expect(page.locator('.settings-dialog-overlay.open')).toBeVisible();
  await expect.poll(() => dialog(page).evaluate(element => getComputedStyle(element).transform)).toBe('none');
};
const navigate = async (page, section) => {
  const back = page.getByRole('button', { name: 'Назад к настройкам' });
  if (await back.isVisible()) await back.click();
  await page.locator(`.settings-nav-item[data-section="${section}"]`).click();
};
const noOverflow = async page => {
  expect(await dialog(page).evaluate(element => {
    const body = element.querySelector('.settings-body');
    const rect = element.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return body.scrollWidth <= body.clientWidth + 1 && bodyRect.right <= rect.right + 1 && body.clientWidth <= rect.width
      && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
  })).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/ui/settings-fixture.html');
  await expect(page.getByRole('button', { name: 'Открыть настройки', exact: true })).toBeVisible();
});

test('six sections, direct and legacy links, mobile Back and low-height layout', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  await open(page);
  await expect(page.locator('.settings-nav-list .settings-nav-item')).toHaveCount(6);
  if (mobile) {
    await expect(dialog(page).getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();
    await expect(dialog(page).locator('#name-input')).toHaveCount(0);
  } else {
    await expect(dialog(page).locator('#name-input')).toBeVisible();
    const bounds = await dialog(page).boundingBox();
    expect(bounds.width).toBe(960);
    expect(bounds.height).toBe(720);
    expect(bounds.x).toBeGreaterThanOrEqual(24);
    expect(bounds.y).toBeGreaterThanOrEqual(24);
    expect((await page.locator('.settings-sidebar').boundingBox()).width).toBe(220);
  }
  for (const section of sections) { await navigate(page, section); await noOverflow(page); }
  await page.setViewportSize({ width: mobile ? 320 : 1024, height: 380 });
  await noOverflow(page);
  await open(page, 'settings');
  await expect(dialog(page).getByRole('heading', { name: 'Оформление', exact: true })).toBeVisible();
  await open(page, 'e2ee');
  await expect(dialog(page).getByRole('heading', { name: 'Безопасность', exact: true })).toBeVisible();
  await page.evaluate(() => window.handleAndroidBackButton());
  if (mobile) {
    await expect(dialog(page).getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await page.evaluate(() => window.handleAndroidBackButton());
  }
  await expect(dialog(page)).toHaveCount(0);
});

test('autosaves send only changed fields, allow independent requests and preserve profile drafts', async ({ page }) => {
  await open(page, 'profile');
  await page.locator('#name-input').fill('Несохранённое имя');
  await page.locator('#bio-input').fill('Несохранённое описание');
  await navigate(page, 'appearance');
  await page.locator('.theme-selection-btn').nth(1).click();
  await expect(page.locator('.theme-selection-btn').first()).toBeDisabled();
  await navigate(page, 'notifications');
  await page.getByRole('switch', { name: 'Уведомления' }).uncheck();
  await expect(page.getByRole('switch', { name: 'Уведомления' })).toBeDisabled();
  expect(await requestFields(page)).toEqual([
    { kind: 'profile', fields: { theme: 'emerald-green' } },
    { kind: 'profile', fields: { notificationsEnabled: false } }
  ]);
  await resolve(page, 1); await resolve(page, 0);
  await navigate(page, 'profile');
  await expect(page.locator('#name-input')).toHaveValue('Несохранённое имя');
  await expect(page.locator('#bio-input')).toHaveValue('Несохранённое описание');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.locator('#name-input')).toBeDisabled();
  expect((await requestFields(page))[2]).toEqual({ kind: 'profile', fields: { name: 'Несохранённое имя', bio: 'Несохранённое описание' } });
  await resolve(page, 2);
  await expect(dialog(page).getByRole('status')).toHaveText('Профиль сохранён.');
  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test('failed theme, notifications and wallpaper autosaves roll back and can be retried', async ({ page }) => {
  await open(page, 'appearance');
  await page.locator('.theme-selection-btn').nth(1).click();
  await resolve(page, 0, 'Ошибка темы');
  await expect(page.locator('.theme-selection-btn').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveText('Ошибка темы');
  await expect(page.locator('.theme-selection-btn').nth(1)).toBeEnabled();
  await navigate(page, 'notifications');
  await page.getByRole('switch', { name: 'Уведомления' }).uncheck();
  await resolve(page, 1, 'Ошибка уведомлений');
  await expect(page.getByRole('switch', { name: 'Уведомления' })).toBeChecked();
  await expect(page.getByRole('alert')).toHaveText('Ошибка уведомлений');
  await page.evaluate(() => window.__settingsTest.setUser(user => ({ ...user, wallpaper: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' })));
  await navigate(page, 'appearance');
  await page.getByRole('button', { name: 'Удалить обои' }).click();
  await resolve(page, 2, 'Ошибка обоев');
  await expect(page.getByRole('button', { name: 'Удалить обои' })).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Ошибка обоев' })).toHaveText('Ошибка обоев');
  await page.getByRole('button', { name: 'Удалить обои' }).click();
  await resolve(page, 3);
  await expect(page.getByRole('button', { name: 'Удалить обои' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Ошибка обоев' })).toHaveCount(0);
});

test('email, password and profile actions are independent, with drafts and errors retained', async ({ page }) => {
  await open(page, 'profile');
  await page.locator('#name-input').fill('Черновик профиля');
  await navigate(page, 'security');
  await page.locator('#settings-email-input').fill('draft@example.test');
  await page.locator('#new-password').fill('new-password');
  await page.locator('#confirm-password').fill('new-password');
  await navigate(page, 'appearance');
  await page.locator('.theme-selection-btn').nth(1).click();
  await resolve(page, 0);
  await navigate(page, 'security');
  await expect(page.locator('#settings-email-input')).toHaveValue('draft@example.test');
  await expect(page.locator('#new-password')).toHaveValue('new-password');
  await page.getByRole('button', { name: 'Изменить email' }).click();
  await expect(page.locator('#settings-email-input')).toBeDisabled();
  await resolve(page, 1, 'Email недоступен');
  await expect(page.getByRole('alert')).toHaveText('Email недоступен');
  await page.getByRole('button', { name: 'Изменить email' }).click();
  await resolve(page, 2);
  await page.getByRole('button', { name: 'Обновить пароль' }).click();
  await expect(page.locator('#new-password')).toBeDisabled();
  await resolve(page, 3, 'Пароль не изменён');
  await expect(page.locator('#new-password')).toHaveValue('new-password');
  await page.getByRole('button', { name: 'Обновить пароль' }).click();
  await resolve(page, 4);
  await expect(page.locator('#new-password')).toHaveValue('');
  expect(await requestFields(page)).toEqual([
    { kind: 'profile', fields: { theme: 'emerald-green' } },
    { kind: 'email', fields: { email: 'draft@example.test' } },
    { kind: 'email', fields: { email: 'draft@example.test' } },
    { kind: 'password', fields: { password: 'new-password' } },
    { kind: 'password', fields: { password: 'new-password' } }
  ]);
  await navigate(page, 'profile');
  await expect(page.locator('#name-input')).toHaveValue('Черновик профиля');
});

test('dirty forms require a discard choice and keyboard focus stays in that choice', async ({ page }, testInfo) => {
  await open(page, 'profile');
  await page.locator('#name-input').fill('Черновик');
  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  const keep = page.getByRole('button', { name: 'Продолжить редактирование' });
  const discard = page.getByRole('button', { name: 'Закрыть без сохранения', exact: true });
  await expect(keep).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(discard).toBeFocused();
  await page.keyboard.press('Tab'); await expect(keep).toBeFocused();
  await keep.click();
  await expect(page.getByRole('button', { name: 'Закрыть настройки' })).toBeFocused();
  await expect(page.locator('#name-input')).toHaveValue('Черновик');
  if (testInfo.project.name === 'desktop') {
    await page.locator('#name-input').focus();
    await page.keyboard.press('Escape'); await expect(keep).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#name-input')).toBeFocused();
  } else {
    await page.evaluate(() => window.handleAndroidBackButton());
    await page.getByRole('button', { name: 'Закрыть настройки' }).focus();
    await page.evaluate(() => window.handleAndroidBackButton()); await expect(keep).toBeFocused();
    await page.evaluate(() => window.handleAndroidBackButton());
    await expect(page.getByRole('button', { name: 'Закрыть настройки' })).toBeFocused();
    await navigate(page, 'profile');
  }
  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  await discard.click();
  await expect(dialog(page)).toHaveCount(0);
  await open(page, 'profile');
  await expect(page.locator('#name-input')).toHaveValue('Тестовый пользователь');
});

test('all six colors work in light and dark modes, local switches survive navigation', async ({ page }) => {
  await open(page, 'appearance');
  for (const light of [false, true]) {
    await page.getByRole('switch', { name: 'Тёмный режим' }).setChecked(!light);
    for (let index = 0; index < 6; index++) {
      await page.locator('.theme-selection-btn').nth(index).click();
      const requestIndex = (await requestFields(page)).length - 1;
      await resolve(page, requestIndex);
      await expect(page.locator('.theme-selection-btn').nth(index)).toBeEnabled();
      await expect(page.locator('.theme-selection-btn').nth(index)).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.classList.contains('theme-light'))).toBe(light);
      await noOverflow(page);
    }
  }
  await expect(page.getByRole('switch', { name: 'Плавные скругления' })).toHaveCount(0);
  await navigate(page, 'notifications');
  await page.getByRole('switch', { name: 'Тактильный отклик' }).uncheck();
  await navigate(page, 'appearance');
  await expect(page.getByRole('switch', { name: 'Плавные скругления' })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Тёмный режим' })).not.toBeChecked();
  await navigate(page, 'notifications');
  await expect(page.getByRole('switch', { name: 'Тактильный отклик' })).not.toBeChecked();
});

test('logout and key reset retain explicit confirmation; technical info is collapsed', async ({ page }) => {
  await open(page, 'security');
  await expect(page.locator('.settings-technical-info')).not.toHaveAttribute('open', '');
  await page.getByText('Технические сведения', { exact: true }).click();
  await expect(page.getByText('settings-fixture', { exact: true })).toBeVisible();
  page.once('dialog', prompt => prompt.dismiss());
  await page.getByRole('button', { name: 'Сбросить ключи E2EE' }).click();
  expect(await page.evaluate(() => window.__settingsTest.keyReset || false)).toBe(false);
  if (await page.getByRole('button', { name: 'Назад к настройкам' }).isVisible()) await page.getByRole('button', { name: 'Назад к настройкам' }).click();
  page.once('dialog', prompt => prompt.dismiss());
  await dialog(page).getByRole('button', { name: 'Выйти из аккаунта' }).click();
  expect(await page.evaluate(() => window.__settingsTest.loggedOut || false)).toBe(false);
  page.once('dialog', prompt => prompt.accept());
  await dialog(page).getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await expect.poll(() => page.evaluate(() => window.__settingsTest.loggedOut)).toBe(true);
});

test('settings styling does not apply to chat or story modals', async ({ page }) => {
  const measure = async name => {
    await page.getByRole('button', { name, exact: true }).click();
    const other = page.locator('.settings-modal-overlay:not(.settings-dialog-overlay)');
    await expect(other).toBeVisible();
    const result = await other.evaluate(element => {
      const modal = element.firstElementChild;
      return { width: modal.getBoundingClientRect().width, radius: getComputedStyle(modal).borderRadius };
    });
    await page.keyboard.press('Escape');
    // Legacy modals do not all handle Escape; close through their existing button.
    if (await other.isVisible()) {
      if (name === 'Создать историю') await other.getByRole('button', { name: 'Закрыть', exact: true }).click();
      else await other.locator('.settings-close-btn').click();
    }
    await expect(other).toHaveCount(0);
    return result;
  };
  const chatBefore = await measure('Создать чат');
  const storyBefore = await measure('Создать историю');
  await open(page); await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  expect(await measure('Создать чат')).toEqual(chatBefore);
  expect(await measure('Создать историю')).toEqual(storyBefore);
});

test('a shrinking visual viewport keeps the focused password field reachable above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'security');
  const field = page.locator('#confirm-password');
  await field.fill('draft-password');
  await field.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 360 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => dialog(page).evaluate(element => element.getBoundingClientRect().bottom)).toBe(360);
  await expect.poll(() => field.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(360);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('draft-password');
  await noOverflow(page);
  await page.getByRole('button', { name: 'Обновить пароль' }).scrollIntoViewIfNeeded();
  expect((await page.getByRole('button', { name: 'Обновить пароль' }).boundingBox()).y).toBeLessThan(360);
});

test('wallpaper completion does not overwrite a pending theme selection', async ({ page }) => {
  await page.evaluate(() => window.__settingsTest.setUser(user => ({ ...user, wallpaper: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' })));
  await open(page, 'appearance');
  await page.locator('.theme-selection-btn').nth(1).click();
  await page.getByRole('button', { name: 'Удалить обои' }).click();
  await resolve(page, 1);
  await expect(page.getByRole('button', { name: 'Удалить обои' })).toHaveCount(0);
  await expect(page.locator('.theme-selection-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.theme-selection-btn').nth(1)).toBeDisabled();
  await resolve(page, 0);
  await expect(page.locator('.theme-selection-btn').nth(1)).toBeEnabled();
  await expect(page.locator('.theme-selection-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('enabling notifications requests permission from the click while the save is pending', async ({ page }) => {
  await page.evaluate(() => {
    window.Notification.requestPermission = async () => {
      window.__settingsTest.permissionRequested = true;
      return 'denied';
    };
  });
  await open(page, 'notifications');
  const control = page.getByRole('switch', { name: 'Уведомления' });
  await control.uncheck(); await resolve(page, 0);
  await expect(control).toBeEnabled();
  await control.check();
  await expect(control).toBeDisabled();
  expect(await page.evaluate(() => window.__settingsTest.permissionRequested)).toBe(true);
  await resolve(page, 1, 'Ошибка сохранения');
  await expect(control).not.toBeChecked();
});
