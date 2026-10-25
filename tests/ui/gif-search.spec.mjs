import { test, expect } from '@playwright/test';
const fixture = '/tests/ui/gif-search-fixture.html';
const gif = id => ({ id, content_description: `Remote GIF ${id}`, media_formats: {
  gif: { url: `https://media.tenor.com/${id}.gif`, dims: [200, 200] },
  tinygif: { url: `https://media.tenor.com/${id}-preview.gif`, dims: [100, 100] }
} });
async function setup(page, respond) {
  const requests = [];
  await page.route('https://media.tenor.com/**', route => route.fulfill({
    contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  }));
  await page.route('https://tenor.googleapis.com/v2/**', async route => {
    const url = new URL(route.request().url());
    // Never include API credentials in traces, assertions or diagnostic output.
    const request = { path: url.pathname, q: url.searchParams.get('q'), pos: url.searchParams.get('pos'),
      client: url.searchParams.get('client_key'), hasKey: Boolean(url.searchParams.get('key')) };
    requests.push(request);
    await respond(route, request);
  });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Открыть GIF', exact: true }).click();
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  return requests;
}
test('featured, Russian and English searches use the API and select its GIF URL', async ({ page }) => {
  const requests = await setup(page, (route, request) => route.fulfill({ json: { results: [gif(request.q || 'featured')], next: '' } }));
  await expect(page.locator('.gif-cell-btn')).toHaveCount(1);
  expect(requests[0]).toMatchObject({ path: '/v2/featured', client: 'tenor_web', hasKey: true });
  for (const query of ['котики в космосе', 'astronaut cats']) {
    await page.locator('.picker-search-input').fill(query);
    await expect(page.locator('.gif-cell-btn')).toHaveAttribute('title', `Remote GIF ${query}`);
    expect(requests.at(-1)).toMatchObject({ path: '/v2/search', q: query, hasKey: true });
  }
  await page.locator('.gif-cell-btn').click();
  await expect(page.getByTestId('selected-gif')).toHaveText('https://media.tenor.com/astronaut cats.gif');
  await expect(page.locator('.media-picker-panel')).toHaveCount(0);
});
test('category search and pagination keep remote results and API cursors', async ({ page }) => {
  const requests = await setup(page, (route, request) => route.fulfill({ json: {
    results: [gif(request.pos ? 'second' : request.q || 'featured')], next: request.pos ? '' : 'remote-cursor'
  } }));
  await expect(page.locator('.gif-cell-btn')).toHaveCount(1);
  await page.getByRole('button', { name: '🐱 Котики', exact: true }).click();
  await expect(page.locator('.gif-cell-btn')).toHaveAttribute('title', 'Remote GIF cats');
  await page.getByRole('button', { name: 'Загрузить ещё', exact: true }).click();
  await expect(page.locator('.gif-cell-btn')).toHaveCount(2);
  expect(requests.at(-1)).toMatchObject({ path: '/v2/search', q: 'cats', pos: 'remote-cursor' });
  await expect(page.getByRole('button', { name: 'Загрузить ещё', exact: true })).toHaveCount(0);
});
test('a successful empty search shows no matches instead of unrelated curated GIFs', async ({ page }) => {
  await setup(page, route => route.fulfill({ json: { results: [], next: '' } }));
  await page.locator('.picker-search-input').fill('cats');
  await expect(page.getByText('GIF не найдены', { exact: true })).toBeVisible();
  await expect(page.locator('.gif-cell-btn')).toHaveCount(0);
});
test('a provider outage preserves the existing curated fallback', async ({ page }) => {
  await setup(page, route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await expect(page.locator('.gif-cell-btn').first()).toBeVisible();
  await expect(page.getByText('Загрузка Tenor GIF...', { exact: true })).toHaveCount(0);
});

const gifBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const deliveryGif = {
  id: 'delivery', content_description: 'Проверка доставки GIF', media_formats: {
    gif: { url: 'https://media1.tenor.com/m/deliveryAAAAC/send.gif', dims: [200, 200] },
    tinygif: { url: 'https://media.tenor.com/deliveryAAAAM/preview.gif', dims: [100, 100] }
  }
};
async function deliverySetup(page, respondToImage, fixturePath = fixture) {
  await page.routeWebSocket(/.*/, () => {});
  await page.route('https://tenor.googleapis.com/v2/**', route => route.fulfill({ json: { results: [deliveryGif], next: '' } }));
  await page.route(/^https:\/\/media1?\.tenor\.com\//, respondToImage);
  await page.goto(fixturePath);
  await page.getByRole('button', { name: fixturePath === fixture ? 'Открыть GIF' : 'Смайлы, стикеры и GIF', exact: true }).click();
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
}
// WebKit can suppress an image error for blocked requests; allow the 10s
// delivery timeout to switch sources, but still require an actually decoded GIF.
const decoded = locator => expect.poll(() => locator.evaluate(image => image.complete && image.naturalWidth > 0), { timeout: 15_000 }).toBe(true);

test('a blocked preview CDN switches to an equivalent address and still selects the original GIF', async ({ page }) => {
  const attempted = [];
  await deliverySetup(page, route => {
    attempted.push(route.request().url());
    return new URL(route.request().url()).hostname === 'media.tenor.com'
      ? route.abort('blockedbyclient') : route.fulfill({ contentType: 'image/gif', body: gifBytes });
  });
  await decoded(page.locator('.gif-preview-img'));
  await expect(page.locator('.gif-preview-img')).toHaveAttribute('src', 'https://media1.tenor.com/m/deliveryAAAAM/preview.gif');
  expect(attempted).toContain(deliveryGif.media_formats.tinygif.url);
  await page.locator('.gif-cell-btn').click();
  await expect(page.getByTestId('selected-gif')).toHaveText(deliveryGif.media_formats.gif.url);
});

test('a stalled preview times out and uses the alternate instead of loading forever', async ({ page }) => {
  let release;
  await deliverySetup(page, route => {
    if (new URL(route.request().url()).hostname === 'media.tenor.com') {
      return new Promise(resolve => { release = () => route.abort('timedout').then(resolve); });
    }
    return route.fulfill({ contentType: 'image/gif', body: gifBytes });
  });
  await expect(page.locator('.gif-cell-btn')).toBeDisabled();
  await expect.poll(() => page.locator('.gif-preview-img').evaluate(image => image.complete && image.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('.gif-preview-img')).toHaveAttribute('src', 'https://media1.tenor.com/m/deliveryAAAAM/preview.gif');
  await release();
});

test('all failed preview addresses show retry and cannot send an invisible GIF', async ({ page }) => {
  let restored = false;
  const attempted = [];
  await deliverySetup(page, route => {
    attempted.push(route.request().url());
    return restored ? route.fulfill({ contentType: 'image/gif', body: gifBytes }) : route.abort('failed');
  });
  const retry = page.getByRole('button', { name: 'Проверка доставки GIF: повторить загрузку', exact: true });
  await expect(retry).toBeVisible();
  expect(attempted).toHaveLength(4);
  await expect(page.getByTestId('selected-gif')).toBeEmpty();
  restored = true;
  await retry.click();
  await decoded(page.locator('.gif-preview-img'));
  await expect(page.getByTestId('selected-gif')).toBeEmpty();
  await page.locator('.gif-cell-btn').click();
  await expect(page.getByTestId('selected-gif')).toHaveText(deliveryGif.media_formats.gif.url);
});

test('sending and reloading a GIF use the real message action and recover a failed full-size CDN', async ({ page }) => {
  await deliverySetup(page, route => {
    const url = new URL(route.request().url());
    return url.hostname === 'media1.tenor.com' && url.pathname.endsWith('/send.gif')
      ? route.abort('blockedbyclient') : route.fulfill({ contentType: 'image/gif', body: gifBytes });
  }, '/tests/ui/message-operations-fixture.html');
  await page.locator('.gif-cell-btn').click();
  const image = page.locator('.bubble-media');
  await decoded(image);
  await expect(image).toHaveAttribute('src', 'https://media.tenor.com/deliveryAAAAC/send.gif');
  await expect.poll(() => page.evaluate(() => window.__messageOperations.requests.filter(request => request.kind === 'send').map(request => request.media))).toEqual([deliveryGif.media_formats.gif.url]);
  await page.reload();
  await decoded(image);
  await image.click();
  await expect(page.getByRole('dialog', { name: 'Просмотр изображения' }).locator('img')).toHaveAttribute('src', 'https://media.tenor.com/deliveryAAAAC/send.gif');
});

test('an unavailable sent GIF stays visible as a retryable attachment and retry never sends it twice', async ({ page }) => {
  let restored = false;
  await deliverySetup(page, route => {
    const url = route.request().url();
    return !restored && url.endsWith('/send.gif') ? route.abort('failed') : route.fulfill({ contentType: 'image/gif', body: gifBytes });
  }, '/tests/ui/message-operations-fixture.html');
  await page.locator('.gif-cell-btn').click();
  await expect(page.locator('.bubble-image-error')).toContainText('Не удалось загрузить изображение');
  restored = true;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await decoded(page.locator('.bubble-media'));
  expect(await page.evaluate(() => window.__messageOperations.requests.filter(request => request.kind === 'send').length)).toBe(1);
});

test('lazy previews outside the visible list do not expire before scrolling to them', async ({ page }) => {
  await page.clock.install();
  const offscreen = { ...deliveryGif, id: 'offscreen', media_formats: {
    gif: { url: 'https://media1.tenor.com/m/offscreen/full.gif' },
    tinygif: { url: 'https://media.tenor.com/offscreen/preview.gif' }
  } };
  await page.route('https://tenor.googleapis.com/v2/**', route => route.fulfill({ json: {
    results: [...Array.from({ length: 100 }, (_, index) => gif(`before-${index}`)), offscreen], next: ''
  } }));
  let restored = false;
  const pending = [];
  await page.route(/^https:\/\/media1?\.tenor\.com\//, route => {
    if (route.request().url().includes('/offscreen/') && !restored) { pending.push(route); return; }
    return route.fulfill({ contentType: 'image/gif', body: gifBytes });
  });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Открыть GIF', exact: true }).click();
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  await expect(page.locator('.gif-cell-btn')).toHaveCount(101);
  await decoded(page.locator('.gif-preview-img').first());
  await page.clock.fastForward(30_000);
  const last = page.locator('.gif-cell-btn').last();
  await expect(last.locator('img')).toHaveAttribute('src', offscreen.media_formats.tinygif.url);
  await expect(last).not.toHaveAttribute('aria-label', /повторить/);
  restored = true;
  await Promise.all(pending.map(route => route.fulfill({ contentType: 'image/gif', body: gifBytes })));
  await last.scrollIntoViewIfNeeded();
  await decoded(last.locator('img'));
  await expect(last).toBeEnabled();
});
