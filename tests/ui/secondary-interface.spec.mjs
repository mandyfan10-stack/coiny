import { test, expect } from '@playwright/test';
const fixture='/tests/ui/interface-fixture.html';
const sizes=[{width:320,height:640},{width:390,height:844},{width:768,height:360},{width:1024,height:360},{width:1920,height:900}];
test.use({reducedMotion:'reduce'});
async function ready(page,query=''){await page.goto(fixture+query);await expect.poll(()=>page.evaluate(()=>Boolean(window.__interfaceTest))).toBe(true);}
async function inside(page,selector){
 await expect.poll(()=>page.locator(selector).evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&box.top>=-1&&box.bottom<=innerHeight+1;})).toBe(true);
 const value=await page.locator(selector).evaluate(node=>{const style=getComputedStyle(node);return {gradient:style.backgroundImage,blur:style.backdropFilter||'none'};});
 expect(value.gradient).toBe('none');expect(value.blur).toBe('none');
}
test('drawer and profile keep native sizes, flat surfaces and a working shared switch',async({page})=>{
 await ready(page,'?list');
 for(const size of sizes){
  await page.setViewportSize(size);
  await page.locator('.sidebar').getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.locator('.drawer-overlay.open')).toBeVisible();
  await expect.poll(()=>page.locator('.drawer-container').evaluate(node=>getComputedStyle(node).transform)).toBe('none');
  await inside(page,'.drawer-container');
  const toggle=page.getByRole('switch',{name:'Ночной режим'});
  await toggle.setChecked(false);await expect(page.locator('html')).toHaveClass(/theme-light/);
  await toggle.setChecked(true);await expect(page.locator('html')).not.toHaveClass(/theme-light/);
  await page.getByRole('button',{name:'Мой профиль'}).click();
  await expect(page.locator('.drawer-overlay')).toHaveCSS('visibility','hidden');
  await expect(page.locator('#name-input')).toBeVisible();
  await inside(page,'.settings-dialog');
  await expect(page.getByTestId('live-profile-preview')).toHaveCSS('box-shadow','none');
  if(size.width<=768){
   for(const light of [true,false]){
    await page.evaluate(light=>window.__interfaceTest.setDark(!light),light);
    const color=light?'rgb(255, 255, 255)':'rgb(245, 245, 245)';
    await expect(page.locator('.settings-dialog .settings-header h2')).toHaveCSS('color',color);
    const close=page.getByRole('button',{name:'Закрыть настройки',exact:true});
    await close.hover();await expect(close).toHaveCSS('color',color);
   }
  }
  await expect(page.getByRole('button',{name:'Загрузить обложку'})).toBeVisible();
  expect((await page.getByRole('button',{name:'Загрузить обложку'}).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button',{name:'Закрыть настройки',exact:true}).click();
 }
});
test('info and create-chat search use the shared field without overflow',async({page})=>{
 await ready(page);
 for(const size of sizes){
  await page.setViewportSize(size);
  await page.evaluate(()=>window.__interfaceTest.openInfo());
  await expect(page.locator('.chat-info.open')).toBeVisible();
  await inside(page,'.chat-info');
  await expect(page.getByRole('button',{name:'Закрыть информацию'})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть информацию'}).click();
  await page.evaluate(()=>window.__interfaceTest.openSettings('appearance'));
  await page.getByRole('button',{name:'Закрыть настройки',exact:true}).click();
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.handleAndroidBackButton());
 await page.getByRole('button',{name:'Создать чат',exact:true}).click();
 await inside(page,'.new-chat-container');
 await page.getByRole('searchbox',{name:'Поиск пользователей'}).fill('Анна');
 await expect(page.locator('.search-user-item').first()).toContainText('Анна');
 await page.locator('.search-user-item').first().focus();await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.__interfaceTest.requests.at(-1)?.kind)).toBe('createChat');
});
test('login, registration and recovery retain form behavior in both modes on short screens',async({page})=>{
 await ready(page,'?surface=auth');
 for(const light of [false,true]){
  await page.evaluate(light=>window.__interfaceTest.setDark(!light),light);
  for(const size of sizes){
   await page.setViewportSize(size);await inside(page,'.auth-screen-container');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.locator('#loginIdentifier').fill('preview_user');await page.locator('#password').fill('PreviewPassword1!');
   await page.getByRole('button',{name:'Показать пароль'}).click();
   await expect(page.locator('#password')).toBeFocused();await expect(page.locator('#password')).toHaveAttribute('type','text');
   await page.getByRole('button',{name:'Скрыть пароль'}).click();
   await page.locator('#password').press('Enter');
   await expect.poll(()=>page.evaluate(()=>window.__interfaceTest.requests.at(-1)?.kind)).toBe('login');
  }
 }
 await page.getByRole('tab',{name:'Регистрация'}).click();await page.locator('#username').fill('preview_user');await page.locator('#password').fill('PreviewPassword1!');
 await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__interfaceTest.requests.at(-1)?.kind)).toBe('register');
 await page.getByRole('button',{name:'Забыли пароль?'}).click();await page.locator('#resetIdentifier').fill('preview@example.test');
 await page.getByRole('button',{name:'Отправить инструкции'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__interfaceTest.requests.at(-1)?.kind)).toBe('recovery');
});
test('encryption setup and unlock retain validation and fit a low screen',async({page})=>{
 await ready(page,'?surface=setup');
 for(const size of sizes){await page.setViewportSize(size);await inside(page,'.e2ee-modal-content');}
 await page.setViewportSize({width:390,height:844});
 const fields=page.locator('.e2ee-modal-content input[type=password]');
 await fields.nth(0).fill('PreviewPassword1!');await fields.nth(1).fill('PreviewPassword1!');
 await page.getByRole('button',{name:'Создать ключи шифрования'}).click();await expect(page.locator('.e2ee-modal-overlay')).toHaveCount(0);
 await ready(page,'?surface=unlock');
 await page.locator('.e2ee-modal-content input').fill('PreviewPassword1!');
 await page.getByRole('button',{name:'Разблокировать историю'}).click();await expect(page.locator('.e2ee-modal-overlay')).toHaveCount(0);
});
test('stories and calls keep controls reachable without decorative effects',async({page})=>{
 await ready(page);
 await page.evaluate(()=>window.__interfaceTest.openStory());
 await expect(page.locator('.story-container')).toBeVisible();
 await page.getByRole('button',{name:'Пауза',exact:true}).click();
 for(const size of sizes){await page.setViewportSize(size);await inside(page,'.story-container');}
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.evaluate(()=>window.__interfaceTest.startCall());
 await expect(page.locator('.call-card')).toBeVisible();
 for(const size of sizes){await page.setViewportSize(size);await inside(page,'.call-card');}
 await expect(page.locator('.wave-pulse')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.locator('.call-card')).toHaveCount(0);
});

test('update dialog scrolls its content and retains keyboard dismissal',async({page})=>{
 await ready(page,'?surface=update');
 for(const size of sizes){await page.setViewportSize(size);await inside(page,'.app-update-dialog');}
 await expect(page.getByRole('button',{name:'Закрыть обновление'})).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Позже',exact:true})).toBeFocused();
 await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Закрыть обновление'})).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('.app-update-dialog')).toHaveCount(0);
});

test('image viewing retains Escape, focus and the chat reading position',async({page})=>{
 await ready(page);
 for(const size of sizes){
  await page.setViewportSize(size);
  const photo=page.locator('[data-message-id="photo"] img');
  await expect.poll(()=>photo.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
  // Reading history starts with user input; programmatic layout changes keep the bottom pin.
  await page.locator('.chat-body').dispatchEvent('wheel',{deltaY:-1000});
  await photo.scrollIntoViewIfNeeded();
  const trigger=page.locator('[data-message-id="photo"] .bubble-media-open');
  await trigger.focus();
  const top=await page.locator('.chat-body').evaluate(node=>node.scrollTop);
  // Keyboard activation does not add Playwright's pointer auto-scroll.
  await trigger.press('Enter');
  await expect(page.getByRole('dialog',{name:'Просмотр изображения'})).toBeVisible();
  await inside(page,'.chat-image-viewer');
  const close=page.getByRole('button',{name:'Закрыть просмотр'});
  await expect(close).toBeFocused();expect((await close.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const media=page.locator('.chat-image-viewer img');
  const bounds=await media.boundingBox();expect(bounds.width).toBeLessThanOrEqual(size.width);expect(bounds.height).toBeLessThanOrEqual(size.height);
  await page.keyboard.press('Escape');await expect(page.locator('.chat-image-viewer')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Anchor restoration can round a fractional CSS offset to the adjacent pixel.
  await expect.poll(()=>page.locator('.chat-body').evaluate((node,top)=>Math.abs(node.scrollTop-top),top)).toBeLessThanOrEqual(1);
 }
});
