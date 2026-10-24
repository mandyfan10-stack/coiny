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
