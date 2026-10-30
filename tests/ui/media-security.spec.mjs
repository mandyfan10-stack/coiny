import { test, expect } from '@playwright/test';

// The isolated browser container has no external network. These fixtures use
// an explicitly controlled transport, so simulate an online session by default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }));
});

for (const image of [false, true]) {
  const label = image ? 'private image' : 'encrypted attachment';
  const open = async page => {
    await page.routeWebSocket(/.*/, () => {});
    await page.goto(`/tests/ui/media-security-fixture.html${image ? '?image' : ''}`);
    await expect.poll(() => page.evaluate(() => window.__mediaSecurity?.requests.length)).toBe(1);
  };
  test(`${label}: a late response cannot repopulate storage after logout`, async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__mediaSecurity.logout());
    await expect(page.getByTestId('owner')).toHaveText('signed-out');
    expect(await page.evaluate(() => window.__mediaSecurity.requests[0].signal.aborted)).toBe(true);
    await page.evaluate(() => {
      window.__mediaSecurity.complete(0);
      window.__mediaSecurity.setUser('owner-b');
    });
    await expect.poll(() => page.evaluate(() => window.__mediaSecurity.requests.length)).toBe(2);
    expect(await page.evaluate(() => window.__mediaSecurity.stats().then(s => s.mediaCount))).toBe(0);
    await page.evaluate(() => window.__mediaSecurity.complete(1, true));
    if (!image) await expect(page.getByTestId('media')).toHaveText('Медиа недоступно');
  });
  test(`${label}: another account misses a warm cache without relying on logout deletion`, async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__mediaSecurity.complete(0));
    await expect.poll(() => page.evaluate(() => window.__mediaSecurity.stats().then(s => s.mediaCount))).toBe(1);
    await page.evaluate(() => window.__mediaSecurity.setUser('owner-b'));
    await expect.poll(() => page.evaluate(() => window.__mediaSecurity.requests.length)).toBe(2);
    await page.evaluate(() => window.__mediaSecurity.complete(1, true));
    if (!image) await expect(page.getByTestId('media')).toHaveText('Медиа недоступно');
  });
  test(`${label}: an authorized same-account cache hit stays available offline`, async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__mediaSecurity.complete(0));
    await expect.poll(() => page.evaluate(() => window.__mediaSecurity.stats().then(s => s.mediaCount))).toBe(1);
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await page.reload();
    await expect(page.getByTestId('owner')).toHaveText('owner-a');
    await expect.poll(() => page.evaluate(() => window.__mediaSecurity.requests.length)).toBe(0);
    if (!image) await expect(page.getByTestId('media')).toHaveText(/^blob:/);
    else await expect.poll(() => page.locator('img[alt="private"]').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  });
}

test('cache context captured before cleanup rejects later writes and forwarding cannot read another account', async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/tests/ui/media-security-fixture.html');
  await expect.poll(() => page.evaluate(() => window.__mediaSecurity?.requests.length)).toBe(1);
  const result = await page.evaluate(async () => {
    const c = window.__mediaSecurity.cache;
    const context = c.createMediaCacheContext('owner-a');
    await c.clearOfflineDatabase();
    await c.saveCachedMedia('late', new Blob(['secret']), 'text/plain', context);
    const late = await c.getCacheStorageStats();
    const fresh = c.createMediaCacheContext('owner-a');
    await c.saveCachedMedia('media:chat-attachments:private/owner-a/msg.webp', new Blob(['private attachment'], { type: 'image/webp' }), 'image/webp', fresh);
    const own = await c.getCachedMedia('media:chat-attachments:private/owner-a/msg.webp', fresh);
    const other = await c.getCachedMedia('media:chat-attachments:private/owner-a/msg.webp', c.createMediaCacheContext('owner-b'));
    void window.__mediaSecurity.forward('owner-b').catch(() => {});
    return { late: late.mediaCount, own: await own.text(), other: Boolean(other) };
  });
  expect(result).toEqual({ late: 0, own: 'private attachment', other: false });
  await expect.poll(() => page.evaluate(() => window.__mediaSecurity.requests.length)).toBe(2);
});

test('upgrade drops unowned legacy media while preserving other offline data', async ({ page }) => {
  await page.route('**/legacy-cache-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Legacy cache</title>' }));
  await page.goto('/legacy-cache-fixture');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('CoinyOfflineDB', 9);
    request.onupgradeneeded = () => {
      const db = request.result;
      const media = db.createObjectStore('media-cache', { keyPath: 'key' });
      media.createIndex('by-accessed', 'lastAccessedAt');
      media.put({ key: 'legacy-private', bytes: new Uint8Array([1, 2]).buffer });
      db.createObjectStore('chat-drafts').put('keep draft', 'draft');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  }));
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/tests/ui/media-security-fixture.html');
  await expect.poll(() => page.evaluate(() => window.__mediaSecurity?.requests.length)).toBe(1);
  const result = await page.evaluate(async () => {
    const c = window.__mediaSecurity.cache;
    const db = await c.initOfflineDB();
    const draft = await new Promise((resolve, reject) => {
      const request = db.transaction('chat-drafts').objectStore('chat-drafts').get('draft');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { version: db.version, count: (await c.getCacheStorageStats()).mediaCount, draft };
  });
  expect(result).toEqual({ version: 10, count: 0, draft: 'keep draft' });
});

test('logout during Blob serialization also rejects the eventual write', async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/tests/ui/media-security-fixture.html');
  await expect.poll(() => page.evaluate(() => window.__mediaSecurity?.requests.length)).toBe(1);
  const count = await page.evaluate(async () => {
    const c = window.__mediaSecurity.cache;
    const blob = new Blob(['private']);
    let complete;
    blob.arrayBuffer = () => new Promise(resolve => { complete = resolve; });
    const write = c.saveCachedMedia('late-serialization', blob, blob.type, c.createMediaCacheContext('owner-a'));
    await c.clearOfflineDatabase();
    complete(new Uint8Array([1, 2]).buffer);
    await write;
    return (await c.getCacheStorageStats()).mediaCount;
  });
  expect(count).toBe(0);
});

test('unsafe Lottie is rejected before rendering and a subsequent ordinary sticker renders', async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  const normal = { v: '5.5.2', w: 512, h: 512, fr: 30, ip: 0, op: 60, assets: [], layers: [{
    ty: 4, ind: 1, sr: 1, ip: 0, op: 60, st: 0, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
      p: { a: 0, k: [256, 256, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    shapes: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [50, 50] } },
      { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 }]
  }] };
  await page.route('**/fixture-dangerous.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    ...normal, layers: [{ ty: 4, shapes: [{ ty: 'rp', c: { a: 0, k: 1e9 } }] }]
  }) }));
  await page.route('**/fixture-ordinary.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(normal) }));
  await page.goto('/tests/ui/media-security-fixture.html?sticker');
  await expect(page.locator('.sticker-fallback')).toBeVisible();
  await expect(page.locator('.sticker-animated svg')).toHaveCount(0);
  await page.evaluate(() => window.__mediaSecurity.setSticker('/fixture-ordinary.json'));
  await expect(page.locator('.sticker-animated svg')).toBeVisible();
  await expect(page.locator('.sticker-animated svg path')).toHaveAttribute('d', /\S/);
  await expect(page.locator('.sticker-fallback')).toHaveCount(0);
});
