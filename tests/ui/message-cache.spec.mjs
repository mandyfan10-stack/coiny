import { test, expect } from '@playwright/test';

test('IndexedDB pages include timestamp ties, preserve microseconds, and exclude other accounts and unsent messages', async ({ page }) => {
  await page.goto('/tests/ui/messenger-fixture.html');
  const result = await page.evaluate(async () => {
    const cache = window.__messengerTest.cache;
    const rows = Array.from({ length: 65 }, (_, index) => ({
      id: String(index).padStart(4, '0'), text: 'cached', senderId: 'peer',
      timestamp: '2026-10-06T12:00:00.123Z',
      createdAt: `2026-10-06T12:00:00.123${index % 2 ? '457' : '451'}Z`
    }));
    await cache.seed(rows);
    await cache.seed([{ ...rows[0], id: 'foreign' }], 'a', 'another-account');
    await cache.seed([{ ...rows[0], id: 'pending', isPending: true, isOptimistic: true }]);
    const ids = [];
    let cursor = { id: 'z', timestamp: '2027-01-01T00:00:00Z' };
    for (let index = 0; index < 4; index++) {
      const older = await cache.page(cursor);
      ids.push(...older.map(row => row.id));
      if (!older.length) break;
      cursor = { id: older[0].id, timestamp: older[0].createdAt };
    }
    return { ids, original: rows.map(row => row.id), cursor };
  });
  expect(result.ids.length).toBe(65);
  expect(new Set(result.ids).size).toBe(65);
  expect(result.ids.sort()).toEqual(result.original.sort());
  expect(result.cursor.timestamp).toBe('2026-10-06T12:00:00.123451Z');
});

test('a server snapshot removes stale cache rows in its covered range while preserving older pages and other chats', async ({ page }) => {
  await page.goto('/tests/ui/messenger-fixture.html');
  const result = await page.evaluate(async () => {
    const cache = window.__messengerTest.cache;
    const timestamp = '2026-10-06T12:00:00.000Z';
    const row = id => ({ id, timestamp, text: id, senderId: 'peer' });
    await cache.seed(['a', 'b', 'c', 'd', 'stale'].map(row));
    await cache.seed([row('other-chat')], 'b');
    await cache.reconcile(['c', 'd'].map(row), 2);
    const partial = (await cache.read()).map(row => row.id);
    await cache.reconcile([]);
    return {
      partial, final: await cache.read(), legacy: await cache.legacy(),
      other: (await cache.read('b')).map(row => row.id)
    };
  });
  expect(result.partial).toEqual(['a', 'b', 'c', 'd']);
  expect(result.final).toEqual([]);
  expect(result.legacy).toEqual([]);
  expect(result.other).toEqual(['other-chat']);
});
