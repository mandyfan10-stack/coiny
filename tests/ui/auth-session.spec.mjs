import { test, expect } from '@playwright/test';

const session = id => id ? { user: { id, email: `${id}@example.invalid` } } : null;
async function open(page) {
  await page.goto('/tests/ui/auth-session-fixture.html');
  await page.waitForFunction(() => window.__authSession?.event && window.__authSession.bootstraps.length);
}
async function event(page, id, type = id ? 'SIGNED_IN' : 'SIGNED_OUT') {
  await page.evaluate(({id,type}) => window.__authSession.event(type, id ? {user:{id}} : null), {id,type});
}
async function bootstrap(page, id) {
  await page.evaluate(value => window.__authSession.bootstraps.shift()({data:{session:value}}), session(id));
}

test('late bootstrap cannot remove a newer login or restore a signed out account', async ({page}) => {
  await open(page);
  await event(page, 'new-owner');
  await expect(page.getByTestId('owner')).toHaveText('new-owner');
  await bootstrap(page, null);
  await expect(page.getByTestId('owner')).toHaveText('new-owner');
  await open(page);
  await event(page, null);
  await bootstrap(page, 'old-owner');
  await event(page, 'old-owner', 'INITIAL_SESSION');
  await expect(page.getByRole('button', {name:'Войти в аккаунт'})).toBeVisible();
  await expect(page.getByTestId('owner')).toHaveCount(0);
});

test('account switch removes old identity while loading and retries the new failed profile', async ({page}) => {
  await open(page);
  await bootstrap(page, 'old-owner');
  await expect(page.getByTestId('owner')).toHaveText('old-owner');
  await page.evaluate(() => {window.__authSession.mode='pending';});
  await event(page, 'new-owner');
  await expect(page.getByTestId('owner')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Загружаем аккаунт…');
  await page.waitForFunction(() => window.__authSession.profiles.length===1);
  await page.evaluate(() => {window.__authSession.profiles.shift().resolve(null);});
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить профиль');
  await page.evaluate(() => {window.__authSession.mode='success';});
  await page.getByRole('button', {name:'Попробовать ещё раз'}).click();
  await expect(page.getByTestId('owner')).toHaveText('new-owner');
});

test('profile failure is visible after accepted sign in and offers retry and exit', async ({page}) => {
  await open(page);
  await bootstrap(page, null);
  await page.evaluate(() => {window.__authSession.mode='error';});
  await page.getByLabel('Email или никнейм').fill('test_owner');
  await page.getByLabel('Пароль',{exact:true}).fill('pass');
  await page.getByRole('button',{name:'Войти в аккаунт'}).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить профиль');
  await page.getByRole('button',{name:'Выйти из аккаунта'}).click();
  await expect(page.getByRole('button',{name:'Войти в аккаунт'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('profile refresh failure preserves the loaded same-account session', async ({page}) => {
  await open(page);
  await bootstrap(page, 'owner');
  await expect(page.getByTestId('owner')).toHaveText('owner');
  await page.evaluate(() => {window.__authSession.mode='error';});
  await event(page, 'owner', 'TOKEN_REFRESHED');
  await expect.poll(() => page.evaluate(() => window.__authSession.auth.authLoading)).toBe(false);
  await expect(page.getByTestId('owner')).toHaveText('owner');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('stale profile result cannot replace a newer account', async ({page}) => {
  await open(page);
  await page.evaluate(() => {window.__authSession.mode='pending';});
  await event(page,'old-owner');
  await page.waitForFunction(() => window.__authSession.profiles.length===1);
  await page.evaluate(() => {window.__authSession.mode='success';});
  await event(page,'new-owner');
  await expect(page.getByTestId('owner')).toHaveText('new-owner');
  await page.evaluate(() => {window.__authSession.profiles.shift().resolve({id:'old-owner',username:'old-owner'});});
  await expect(page.getByTestId('owner')).toHaveText('new-owner');
});

test('timed out profile gives a retry and late response cannot undo it', async ({page}) => {
  await open(page);
  await page.evaluate(() => {window.__authSession.mode='pending';});
  await bootstrap(page,'owner');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить профиль');
  await page.evaluate(() => {window.__authSession.mode='success';});
  await page.getByRole('button',{name:'Попробовать ещё раз'}).click();
  await expect(page.getByTestId('owner')).toHaveText('owner');
  await page.evaluate(() => {window.__authSession.profiles.shift().resolve(null);});
  await expect(page.getByTestId('owner')).toHaveText('owner');
});

for (const nextId of ['another-owner', 'owner']) {
  test(`email result from prior session is cancelled after logout and login as ${nextId}`, async ({page}) => {
    await open(page);
    await bootstrap(page,'owner');
    await expect(page.getByTestId('owner')).toHaveText('owner');
    await page.evaluate(() => {window.__authSession.emailResult=window.__authSession.auth.updateEmail('changed@example.invalid');});
    await page.evaluate(() => window.__authSession.auth.logOut());
    await expect(page.getByRole('button',{name:'Войти в аккаунт'})).toBeVisible();
    await event(page,nextId);
    await expect(page.getByTestId('owner')).toHaveText(nextId);
    const result = await page.evaluate(async () => {
      window.__authSession.finishEmail({data:{user:{email:'changed@example.invalid'}},error:null});
      return await window.__authSession.emailResult;
    });
    expect(result).toEqual({cancelled:true});
    expect(await page.evaluate(() => window.__authSession.auth.currentUser.email)).toBe('');
  });
}

test('missing bootstrap response gives bounded error and retry is bounded again', async ({page}) => {
  await open(page);
  await expect(page.getByRole('alert')).toContainText('Не удалось восстановить вход');
  await page.getByRole('button',{name:'Попробовать ещё раз'}).click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Не удалось восстановить вход');
  // A new auth event still wins after either bootstrap request has timed out.
  await event(page,'owner');
  await expect(page.getByTestId('owner')).toHaveText('owner');
  await bootstrap(page,null);
  await expect(page.getByTestId('owner')).toHaveText('owner');
});

for (const nextId of ['another-owner', 'owner']) {
  test(`late signout continuation does not erase the new session for ${nextId}`, async ({page}) => {
    await open(page);
    await bootstrap(page,'owner');
    await expect(page.getByTestId('owner')).toHaveText('owner');
    await page.evaluate(() => {
      window.__authSession.holdSignOut = true;
      window.__authSession.logoutResult = window.__authSession.auth.logOut();
    });
    await expect(page.getByRole('button',{name:'Войти в аккаунт'})).toBeVisible();
    await event(page,nextId);
    await expect(page.getByTestId('owner')).toHaveText(nextId);
    await page.evaluate(() => localStorage.setItem('coingram-new-session-marker','preserve'));
    const result = await page.evaluate(async () => {
      window.__authSession.finishSignOut();
      return await window.__authSession.logoutResult;
    });
    expect(result).toEqual({cancelled:true});
    await expect(page.getByTestId('owner')).toHaveText(nextId);
    expect(await page.evaluate(() => localStorage.getItem('coingram-new-session-marker'))).toBe('preserve');
  });
}
