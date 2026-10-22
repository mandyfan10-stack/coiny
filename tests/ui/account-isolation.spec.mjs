import { test, expect } from '@playwright/test';

const message = (id, text = id) => ({ id, text, senderId: 'peer', timestamp: '2026-10-18T10:00:00Z' });
const chat = (id, messages = []) => ({ id, name: id, type: 'group', members: [], messages });
const state = page => page.evaluate(() => ({
  user: window.__accountIsolation.auth.currentUser?.id,
  chats: window.__accountIsolation.chat.chats,
  active: window.__accountIsolation.chat.activeChatId,
  pagination: window.__accountIsolation.chat.messagePagination
}));
const requests = page => page.evaluate(() => window.__accountIsolation.requests.map(({ kind, owner, chatId, limit, done }) => ({ kind, owner, chatId, limit, done })));
async function login(page, id) {
  await page.evaluate(id => window.__accountIsolation.login(id, 'fixture-password'), id);
  await expect(page.getByTestId('owner')).toHaveText(id);
  await expect.poll(() => requests(page).then(rows => rows.some(row => row.kind === 'chats' && row.owner === id && !row.done))).toBe(true);
}
async function complete(page, index, rows) {
  await page.evaluate(({ index, rows }) => window.__accountIsolation.complete(index, rows), { index, rows });
}
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/tests/ui/account-isolation-fixture.html');
  await expect(page.getByTestId('owner')).toHaveText('signed-out');
});

test('logout hides chats immediately, and returning to the same account rejects old setters', async ({ page }) => {
  await login(page, 'old-owner');
  await complete(page, 0, [chat('private', [message('secret', 'Private old account text')])]);
  await expect.poll(() => state(page).then(value => value.chats.map(row => row.id))).toEqual(['private']);
  await page.evaluate(() => {
    window.__staleSetChats = window.__accountIsolation.chat.setChats;
    window.__accountIsolation.chat.setActiveChatId('private');
  });
  await page.evaluate(() => window.__accountIsolation.logout());
  await expect(page.getByTestId('owner')).toHaveText('signed-out');
  expect((await state(page)).chats).toEqual([]);
  await login(page, 'old-owner');
  await page.evaluate(() => window.__staleSetChats([{ id: 'stale-private', messages: [] }]));
  const current = await state(page);
  expect(current.chats).toEqual([]);
  expect(current.active).toBeNull();
});

test('a previous login cannot publish its delayed chat-list response in the next account', async ({ page }) => {
  await login(page, 'old-owner');
  await page.evaluate(() => window.__accountIsolation.logout());
  await login(page, 'new-owner');
  await complete(page, 0, [chat('old-private', [message('secret', 'Private old account text')])]);
  await complete(page, 1, [chat('new-private', [message('new-message')])]);
  await expect.poll(() => state(page).then(value => value.chats.map(row => row.id))).toEqual(['new-private']);
  expect((await state(page)).chats.flatMap(row => row.messages).some(row => row.id === 'secret')).toBe(false);
});

test('a delayed history page cannot enter a shared chat after account replacement', async ({ page }) => {
  await login(page, 'old-owner');
  await complete(page, 0, [chat('shared', [message('old-preview')])]);
  await expect.poll(() => state(page).then(value => value.chats.length)).toBe(1);
  await page.evaluate(() => { window.__oldPage = window.__accountIsolation.chat.loadOlderMessages('shared'); });
  await expect.poll(() => requests(page).then(rows => rows.some(row => row.kind === 'messages' && row.limit === 30))).toBe(true);
  const pageIndex = (await requests(page)).findIndex(row => row.kind === 'messages' && row.limit === 30);
  await page.evaluate(() => window.__accountIsolation.logout());
  await login(page, 'new-owner');
  const newIndex = (await requests(page)).findIndex(row => row.kind === 'chats' && row.owner === 'new-owner');
  await complete(page, newIndex, [chat('shared', [message('new-preview')])]);
  await expect.poll(() => state(page).then(value => value.chats[0]?.messages.map(row => row.id))).toEqual(['new-preview']);
  await complete(page, pageIndex, [message('old-secret', 'Private old history page')]);
  expect(await page.evaluate(() => window.__oldPage)).toBe(0);
  const current = await state(page);
  expect(current.chats[0].messages.map(row => row.id)).toEqual(['new-preview']);
  expect(current.pagination).toEqual({});
});

test('late background prewarming cannot add the previous account history', async ({ page }) => {
  await login(page, 'old-owner');
  await complete(page, 0, [chat('shared', [message('old-preview')])]);
  await expect.poll(() => requests(page).then(rows => rows.some(row => row.kind === 'messages' && row.limit === 50))).toBe(true);
  const prewarmIndex = (await requests(page)).findIndex(row => row.kind === 'messages' && row.limit === 50);
  await page.evaluate(() => window.__accountIsolation.logout());
  await login(page, 'new-owner');
  const newIndex = (await requests(page)).findIndex(row => row.kind === 'chats' && row.owner === 'new-owner');
  await complete(page, newIndex, [chat('shared')]);
  await expect.poll(() => state(page).then(value => value.chats[0]?.id)).toBe('shared');
  await complete(page, prewarmIndex, [message('old-secret', 'Private old prewarm text')]);
  // Resolve a newer request as a barrier through the same real loader, so a
  // stale background continuation has time to run without an arbitrary delay.
  await expect.poll(() => requests(page).then(rows => rows.some(row => row.kind === 'messages' && row.owner === 'new-owner' && row.limit === 50))).toBe(true);
  const newPrewarm = (await requests(page)).findIndex(row => row.kind === 'messages' && row.owner === 'new-owner' && row.limit === 50);
  await complete(page, newPrewarm, [message('new-history')]);
  await expect.poll(() => state(page).then(value => value.chats[0]?.messages.map(row => row.id))).toEqual(['new-history']);
});

test('cleanup waits through a native blocked event and rejects cache reopen attempts until deletion completes', async ({ page }) => {
  await page.evaluate(async () => {
    const storage = await import('/src/utils/indexedDbHelper.js');
    await storage.saveCachedMessagesBatch('private', [{ id: 'cached', text: 'Private cached text' }], 'old-owner');
    const holder = await new Promise((resolve, reject) => {
      const request = indexedDB.open('CoinyOfflineDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = (...args) => {
      const request = nativeDelete(...args);
      request.addEventListener('blocked', () => { window.__nativeCleanupBlocked = true; });
      return request;
    };
    window.__cleanupHolder = holder;
    window.__cleanupResult = storage.clearOfflineDatabase();
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeCleanupBlocked))).toBe(true);
  expect(await page.evaluate(async () => {
    const storage = await import('/src/utils/indexedDbHelper.js');
    let rejected = null;
    try { await storage.initOfflineDB(); } catch (error) { rejected = error.code; }
    return { rejected, cached: await storage.getCachedMessagesForChat('private', 'old-owner') };
  })).toEqual({ rejected: 'COINY_STORAGE_CLEARING', cached: [] });
  await page.evaluate(async () => { window.__cleanupHolder.close(); await window.__cleanupResult; });
  expect(await page.evaluate(async () => (await import('/src/utils/indexedDbHelper.js')).getCachedMessagesForChat('private', 'old-owner'))).toEqual([]);
});

test('a real cleanup blocker reports a bounded error and keeps storage closed until the blocker releases it', async ({ page }) => {
  await page.evaluate(async () => {
    const storage = await import('/src/utils/indexedDbHelper.js');
    await storage.initOfflineDB();
    window.__cleanupHolder = await new Promise((resolve, reject) => {
      const request = indexedDB.open('CoinyOfflineDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    window.__cleanupStarted = performance.now();
    window.__cleanupResult = storage.clearOfflineDatabase().then(() => null, error => error.message);
  });
  const result = await page.evaluate(async () => ({
    error: await window.__cleanupResult, elapsed: performance.now() - window.__cleanupStarted
  }));
  expect(result.error).toContain('закройте другие вкладки Coiny');
  expect(result.elapsed).toBeGreaterThanOrEqual(4500);
  expect(result.elapsed).toBeLessThan(10_000);
  await page.evaluate(async () => {
    const storage = await import('/src/utils/indexedDbHelper.js');
    try { await storage.initOfflineDB(); throw new Error('Cleanup unexpectedly reopened storage'); }
    catch (error) { if (error.code !== 'COINY_STORAGE_CLEARING') throw error; }
    window.__cleanupHolder.close();
    await storage.clearOfflineDatabase();
    await storage.initOfflineDB();
  });
});

test('queued draft encryption cannot recreate private data after a real logout', async ({ page }) => {
  await login(page, 'old-owner');
  await page.evaluate(() => {
    const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const gate = new Promise(resolve => { window.__releaseDraftEncryption = resolve; });
    crypto.subtle.encrypt = async (...args) => {
      if (new TextDecoder().decode(args[0].additionalData).startsWith('draft:')) {
        window.__draftEncryptionHeld = true;
        await gate;
        const result = await originalEncrypt(...args);
        window.__draftEncryptionCompleted = true;
        return result;
      }
      return originalEncrypt(...args);
    };
    window.__accountIsolation.chat.updateDraft('private', { text: 'Private draft one' });
    window.__accountIsolation.chat.updateDraft('private', { text: 'Private draft two' });
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__draftEncryptionHeld))).toBe(true);
  await page.evaluate(() => window.__accountIsolation.logout());
  await page.evaluate(() => {
    const nativeOpen = indexedDB.open.bind(indexedDB);
    window.__opensAfterLogout = 0;
    indexedDB.open = (...args) => { window.__opensAfterLogout += 1; return nativeOpen(...args); };
    window.__releaseDraftEncryption();
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.__draftEncryptionCompleted))).toBe(true);
  expect(await page.evaluate(() => window.__opensAfterLogout)).toBe(0);
  expect(await page.evaluate(async () => (await import('/src/utils/indexedDbHelper.js')).loadChatDrafts('old-owner'))).toEqual({});
});

for (const destination of ['signed-out', 'new-owner', 'old-owner']) {
  for (const online of [false, true]) {
    test(`pending media preparation cannot outlive logout into ${destination} (${online ? 'online' : 'offline'})`, async ({ page }) => {
      await login(page, 'old-owner');
      await complete(page, 0, [chat('shared')]);
      await expect.poll(() => state(page).then(value => value.chats.length)).toBe(1);
      await page.evaluate(online => {
        const control = window.__accountIsolation;
        control.chat.setActiveChatId('shared');
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
        window.dispatchEvent(new Event(online ? 'online' : 'offline'));
        const original = crypto.subtle.encrypt.bind(crypto.subtle);
        crypto.subtle.encrypt = async (...args) => {
          if (new TextDecoder().decode(args[0].additionalData).startsWith('attachment:')) {
            window.__attachmentHeld = true;
            await new Promise(resolve => { window.__releaseAttachment = resolve; });
          }
          return original(...args);
        };
      }, online);
      await expect.poll(() => state(page).then(value => value.active)).toBe('shared');
      await page.evaluate(() => {
        const send = window.__accountIsolation.chat.sendMessage;
        window.__oldSend = send;
        window.__pendingSend = send('PRIVATE OLD CAPTION', null, null, new Blob(['private media'], { type: 'image/png' }), 'image');
      });
      await expect.poll(() => page.evaluate(() => Boolean(window.__attachmentHeld))).toBe(true);
      await page.evaluate(() => window.__accountIsolation.logout());
      await expect(page.getByTestId('owner')).toHaveText('signed-out');
      if (destination !== 'signed-out') {
        await login(page, destination);
        const index = (await requests(page)).findIndex(row => row.kind === 'chats' && row.owner === destination && !row.done);
        await complete(page, index, [chat('shared')]);
        await expect.poll(() => state(page).then(value => value.chats.length)).toBe(1);
      }
      expect(await page.evaluate(async () => { window.__releaseAttachment(); return window.__pendingSend; })).toBe(false);
      expect(await page.evaluate(() => window.__oldSend('STALE CALLBACK', null, null, null, null, null, { chatId: 'shared' }))).toBe(false);
      const result = await page.evaluate(async destination => {
        const storage = await import('/src/utils/indexedDbHelper.js');
        return { sent: window.__accountIsolation.sent, oldCache: await storage.getCachedMessagesForChat('shared', 'old-owner'),
          queue: await storage.loadEncryptedOfflineQueue(destination === 'signed-out' ? 'old-owner' : destination) };
      }, destination);
      expect(result).toEqual({ sent: [], oldCache: [], queue: [] });
    });
  }
}
