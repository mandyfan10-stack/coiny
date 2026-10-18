import { test, expect } from '@playwright/test';
test.beforeEach(async ({page}) => { await page.routeWebSocket(/.*/, () => {}); });
const fixture = '/tests/ui/message-operations-fixture.html';
const input = page => page.getByRole('textbox', { name: 'Сообщение', exact: true });
async function open(page) {
 await page.goto(fixture);
 await expect(input(page)).toBeVisible();
}
async function select(page, id) { await page.evaluate(id => window.__messageOperations.select(id), id); }
async function action(page, id, name) {
 const bubble = page.locator(`[data-message-id="${id}"] .message-bubble`);
 if (await page.evaluate(() => matchMedia('(min-width:769px) and (hover:hover) and (pointer:fine)').matches)) {
  await bubble.hover();
  await page.locator(`[data-message-actions-for="${id}"]`).getByRole('button', {name, exact:true}).click();
  return;
 }
 await bubble.locator('.message-text [dir="auto"]').tap();
 const sheet = page.getByRole('dialog', { name: 'Действия с сообщением' });
 await sheet.getByRole('menuitem', { name, exact: true }).click();
}
test('draft text and reply survive switching, reload and edit cancellation without mixing accounts', async ({ page }) => {
 await open(page);
 await input(page).fill('Черновик первого чата');
 await action(page, 'two', 'Ответить');
 await select(page, 'target'); await input(page).fill('Другой черновик');
 await select(page, 'source'); await expect(input(page)).toHaveValue('Черновик первого чата');
 await expect(page.getByRole('button', { name: 'Отменить ответ' })).toBeVisible();
 await action(page, 'one', 'Изменить'); await input(page).fill('Несохранённая правка');
 await page.getByRole('button', { name: 'Отменить редактирование' }).click();
 await expect(input(page)).toHaveValue('Черновик первого чата');
 await expect.poll(() => page.evaluate(async () => {
  const { loadChatDrafts } = await import('/src/utils/indexedDbHelper.js');
  return (await loadChatDrafts('self')).source?.text;
 })).toBe('Черновик первого чата');
 await page.reload(); await expect(input(page)).toHaveValue('Черновик первого чата');
 await select(page, 'target'); await expect(input(page)).toHaveValue('Другой черновик');
 await page.evaluate(() => window.__messageOperations.setUser({ id: 'another', name: 'Другой' }));
 await expect(input(page)).toHaveValue('');
});
test('edits update the same bubble, retain the draft and keep failed edit text', async ({ page }) => {
 await open(page); await input(page).fill('Черновик');
 await action(page, 'one', 'Изменить'); await input(page).fill('Исправленный текст');
 await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
 await expect(page.locator('[data-message-id="one"]')).toContainText('Исправленный текст');
 await expect(page.locator('[data-message-id="one"] .message-edited')).toHaveText('изменено');
 await expect(input(page)).toHaveValue('Черновик');
 await expect(page.locator('[data-message-id]')).toHaveCount(3);
 await action(page, 'one', 'Изменить'); await input(page).fill('Не потерять при ошибке');
 await page.evaluate(() => { window.__messageOperations.failEdit = true; });
 await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
 await expect(page.getByRole('alert')).toContainText('ошибка');
 await expect(input(page)).toHaveValue('Не потерять при ошибке');
 await expect(page.locator('[data-message-id="one"]')).toContainText('Исправленный текст');
});
test('forwarding multiple messages preserves order, origin, comment and source drafts', async ({ page }) => {
 await open(page); await input(page).fill('Сохранить исходный черновик');
 await action(page, 'one', 'Выбрать');
 await page.locator('[data-message-id="two"]').getByRole('checkbox').check();
 await page.getByRole('toolbar', { name: 'Выбранные сообщения' }).getByRole('button', { name: 'Переслать' }).click();
 const dialog = page.getByRole('dialog', { name: 'Переслать сообщения' });
 await dialog.getByRole('option', { name: 'Друзья' }).click();
 await dialog.getByRole('textbox', { name: 'Комментарий к пересылке' }).fill('Посмотри');
 await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
 await expect(dialog).toHaveCount(0);
 await expect(input(page)).toHaveValue('Сохранить исходный черновик');
 await select(page, 'target');
 const rows = page.locator('[data-message-id]'); await expect(rows).toHaveCount(3);
 await expect(rows.nth(0)).toContainText('Посмотри');
 await expect(rows.nth(1)).toContainText('Первое сообщение'); await expect(rows.nth(1)).toContainText('Переслано от Алексей');
 await expect(rows.nth(2)).toContainText('Сообщение Анны'); await expect(rows.nth(2)).toContainText('Переслано от Анна');
});
test('desktop Up edits the latest own message and Escape restores composition; Back dismisses forward dialog first', async ({ page }) => {
 await open(page); await input(page).press('ArrowUp');
 await expect(input(page)).toHaveValue('Ещё одно сообщение');
 await input(page).press('Escape'); await expect(input(page)).toHaveValue('');
 await action(page, 'two', 'Переслать');
 const dialog = page.getByRole('dialog', { name: 'Переслать сообщения' }); await expect(dialog).toBeVisible();
 await page.evaluate(() => window.handleAndroidBackButton());
 await expect(dialog).toHaveCount(0); await expect(input(page)).toBeVisible();
});

test('partial forwarding retry does not duplicate acknowledged messages or the comment', async ({ page }) => {
 await open(page); await action(page,'one','Выбрать');
 await page.locator('[data-message-id="two"]').getByRole('checkbox').check();
 await page.getByRole('toolbar',{name:'Выбранные сообщения'}).getByRole('button',{name:'Переслать'}).click();
 const dialog=page.getByRole('dialog',{name:'Переслать сообщения'});
 await dialog.getByRole('option',{name:'Друзья'}).click();
 await dialog.getByRole('textbox',{name:'Комментарий к пересылке'}).fill('Комментарий');
 await page.evaluate(()=>{window.__messageOperations.failSendAt=3;});
 await dialog.getByRole('button',{name:'Отправить',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Не удалось');
 await expect(dialog.getByRole('status')).toContainText('1 из 2');
 await page.evaluate(()=>{window.__messageOperations.failSendAt=null;});
 await dialog.getByRole('button',{name:'Продолжить пересылку'}).click();
 await expect(dialog).toHaveCount(0); await select(page,'target');
 await expect(page.locator('[data-message-id]')).toHaveCount(3);
 await expect(page.locator('.message-text').filter({hasText:'Комментарий'})).toHaveCount(1);
});

test('drafts stay encrypted and decrypt across simultaneous tabs', async ({ page, context }) => {
 const other=await context.newPage();
 await Promise.all([open(page),open(other)]);
 await input(page).fill('Секретный черновик один');
 await select(other,'target');await input(other).fill('Секретный черновик два');
 for (const tab of [page,other]) {
  await expect.poll(()=>tab.evaluate(async()=>{
   const {loadChatDrafts}=await import('/src/utils/indexedDbHelper.js');
   const drafts=await loadChatDrafts('self');return Object.values(drafts).map(item=>item.text).sort();
  })).toEqual(['Секретный черновик два','Секретный черновик один']);
 }
 const raw=await page.evaluate(async()=>{
  const {initOfflineDB}=await import('/src/utils/indexedDbHelper.js');const db=await initOfflineDB();
  return new Promise((resolve,reject)=>{const request=db.transaction('chat-drafts','readonly').objectStore('chat-drafts').getAll();request.onsuccess=()=>resolve(JSON.stringify(request.result));request.onerror=()=>reject(request.error);});
 });
 expect(raw).not.toContain('Секретный');expect(raw).not.toContain('replyTo');
 await other.close();
});

test('private attachments are decrypted at source and encrypted anew for the recipient chat', async ({ page }) => {
 await open(page);
 const result=await page.evaluate(async()=>{
  const {supabase}=await import('/src/supabaseClient.js');
  const {dataService}=await import('/src/services/dataLayer.js');
  const {prepareForwardMedia}=await import('/src/services/forwardMedia.js');
  const {encryptFileForE2EE,decryptFile}=await import('/src/utils/e2eeHelper.js');
  const sourceKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const targetKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const original=new Blob(['private image bytes'],{type:'image/png'});
  const encrypted=await encryptFileForE2EE(original,sourceKey); let uploaded;
  const storage=supabase.storage;const savedFrom=storage.from;
  const live=dataService.isLive;dataService.isLive=()=>true;
  storage.from=()=>({download:async()=>({data:encrypted,error:null}),upload:async(path,blob,options)=>{uploaded={path,blob,options};return{error:null};}});
  const source={id:'source',type:'personal',members:[{id:'self'},{id:'peer'}]};
  const target={...source,id:'target'};
  try {
   const url=await prepareForwardMedia({text:'Подпись',media:'storage://chat-attachments/source/self/photo.png'},source,target,'self','new-message',{
    e2eePrivateKey:null,sharedKeysCache:{source:sourceKey,target:targetKey},setSharedKeysCache:()=>{},guard:()=>{}
   });
   const decoded=await decryptFile(uploaded.blob,targetKey,'image/png');
   let sourceKeyRejected=false;try{await decryptFile(uploaded.blob,sourceKey,'image/png');}catch{sourceKeyRejected=true;}
   return {url,path:uploaded.path,contentType:uploaded.options.contentType,text:await decoded.text(),sourceKeyRejected,different:await uploaded.blob.text()!==await encrypted.text()};
  } finally { storage.from=savedFrom;dataService.isLive=live; }
 });
 expect(result.path).toBe('target/self/forward_new-message.png');
 expect(result.contentType).toBe('application/octet-stream');expect(result.text).toBe('private image bytes');
 expect(result.sourceKeyRejected).toBe(true);expect(result.different).toBe(true);expect(result.url).not.toContain('source/self');
});

test('forward dialog fits a narrow low viewport and traps keyboard focus', async ({ page }) => {
 await open(page);await action(page,'one','Переслать');
 const dialog=page.getByRole('dialog',{name:'Переслать сообщения'});
 for(const size of [{width:320,height:360},{width:390,height:360},{width:1024,height:360}]){
  await page.setViewportSize(size);
  await expect.poll(()=>dialog.evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&box.top>=-1&&box.bottom<=innerHeight+1;})).toBe(true);
 }
 await dialog.getByRole('textbox',{name:'Найти чат для пересылки'}).focus();
 await page.keyboard.press('Shift+Tab');
 await expect.poll(()=>dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(input(page)).toBeFocused();
});

test('encrypted realtime edits preserve the newest revision, reactions and read receipts despite slow decryption', async ({ page }) => {
 await open(page);
 await page.evaluate(async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  window.__messageOperations.testKey = key;
  window.__messageOperations.enableRealtime(key);
 });
 await expect.poll(() => page.evaluate(() => window.__messageOperations.listenerCount())).toBe(3);
 await page.evaluate(async () => {
  const control = window.__messageOperations;
  const { encryptMessage } = await import('/src/utils/e2eeHelper.js');
  const encrypt = async text => { const value = await encryptMessage(text, control.testKey); return `e2ee:aes-gcm:${value.ciphertext}:${value.iv}`; };
  const row = { id: 'two', chat_id: 'source', sender_id: 'peer', text: await encrypt('Первая правка'), media: null,
   forwarded_from: null, reply_to: null, edited_at: '2026-10-18T12:00:00.123456Z', read: false, reactions: [] };
  const newer = { ...row, text: await encrypt('Последняя правка'), edited_at: '2026-10-18T12:00:00.123457Z',
   reactions: [{ emoji: '👍', count: 1, users: ['peer'] }] };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const original = crypto.subtle.decrypt.bind(crypto.subtle);
  let first = true;
  crypto.subtle.decrypt = async (...args) => { if (first) { first = false; await gate; } return original(...args); };
  try {
   const pending = control.emit('messages', 'UPDATE', row);
   await new Promise(resolve => setTimeout(resolve, 0));
   await control.emit('messages', 'UPDATE', newer);
   await control.emit('message_reads', 'INSERT', { message_id: 'two', profile_id: 'self' });
   release(); await pending;
  } finally { release(); crypto.subtle.decrypt = original; }
 });
 const row = page.locator('[data-message-id="two"]');
 await expect(row).toContainText('Последняя правка');
 await expect(row.locator('.message-edited')).toHaveText('изменено');
 await expect.poll(() => page.evaluate(() => {
  const item = window.__messageOperations.chats.find(chat => chat.id === 'source').messages.find(message => message.id === 'two');
  return { text: item.text, read: item.read, reads: item.reads, reactions: item.reactions };
 })).toEqual({ text: 'Последняя правка', read: true, reads: ['self'], reactions: [{ emoji: '👍', count: 1, users: ['peer'] }] });
});

test('creating Saved for forwarding keeps the source chat and its draft open', async ({ page }) => {
 await open(page); await input(page).fill('Исходный черновик');
 await page.evaluate(() => window.__messageOperations.removeSaved());
 await action(page, 'two', 'Переслать');
 const dialog = page.getByRole('dialog', { name: 'Переслать сообщения' });
 await dialog.getByRole('button', { name: 'Добавить «Избранное»' }).click();
 await expect(dialog.getByRole('option', { name: 'Избранное' })).toHaveAttribute('aria-selected', 'true');
 await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
 await expect(dialog).toHaveCount(0); await expect(input(page)).toHaveValue('Исходный черновик');
 await select(page, 'chat-saved-self');
 await expect(page.locator('[data-message-id]')).toContainText('Сообщение Анны');
 await expect(page.locator('.message-forward-origin')).toContainText('Анна');
});

test('sending retains the keyboard focus and clears a persisted draft only after acceptance', async ({ page }) => {
 await open(page); await input(page).fill('Отправить без потери фокуса');
 await input(page).press('Enter');
 await expect(input(page)).toHaveValue(''); await expect(input(page)).toBeFocused();
 await expect.poll(() => page.evaluate(async () => {
  const { loadChatDrafts } = await import('/src/utils/indexedDbHelper.js');
  return (await loadChatDrafts('self')).source;
 })).toBeUndefined();
});

test('forwarding fits the visual viewport above a mobile keyboard', async ({ page }) => {
 await open(page); await action(page, 'one', 'Переслать');
 await page.setViewportSize({ width: 390, height: 844 });
 const dialog = page.getByRole('dialog', { name: 'Переслать сообщения' });
 await page.evaluate(() => {
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 320 });
  Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 100 });
  window.visualViewport.dispatchEvent(new Event('resize'));
 });
 await expect.poll(() => dialog.evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 99 && box.bottom <= 421; })).toBe(true);
 await dialog.getByRole('textbox', { name: 'Комментарий к пересылке' }).fill('Комментарий с клавиатурой');
 await expect(dialog.getByRole('button', { name: 'Отправить', exact: true })).toBeInViewport();
});
