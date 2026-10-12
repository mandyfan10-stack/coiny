import { test, expect } from '@playwright/test';

async function open(page, query = '') {
  await page.goto(`/tests/ui/call-signaling-fixture.html${query}`);
  await expect(page.getByTestId('A')).toHaveText('idle');
  await expect(page.getByTestId('B')).toHaveText('idle');
}

test('late connection receives an invitation and confirms receipt without resetting the incoming call', async ({ page }) => {
  await open(page, '?hold=B');
  await page.evaluate(() => window.__callSignalingTest.start());
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.sent.filter((item) => item.event === 'incoming-call').length)).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('B')).toHaveText('idle');
  await page.evaluate(() => window.__callSignalingTest.channels.find((item) => item.owner === 'B').connect(true));
  await expect(page.getByTestId('B')).toHaveText('incoming');
  const count = await page.evaluate(() => window.__callSignalingTest.sent.filter((item) => item.event === 'incoming-call').length);
  await page.waitForTimeout(1_800);
  expect(await page.evaluate(() => window.__callSignalingTest.sent.filter((item) => item.event === 'incoming-call').length)).toBe(count);
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('A')).toHaveText('connected');
  await page.evaluate(() => window.__callSignalingTest.end());
  await expect(page.getByTestId('B')).toHaveText('ended');
});

test('dropped broadcasts and temporary encryption failures recover with fresh encrypted events', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callSignalingTest.drop = 2; window.__callSignalingTest.failEncryption = 1; window.__callSignalingTest.start(); });
  await expect(page.getByTestId('B')).toHaveText('incoming', { timeout: 10_000 });
  const sent = await page.evaluate(() => window.__callSignalingTest.sent.filter((item) => item.event === 'incoming-call'));
  expect(sent).toHaveLength(3);
  expect(new Set(sent.map((item) => item.counter)).size).toBe(3);
});

test('receiver reconnects during ringing and receives the pending invitation', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callSignalingTest.channels.find((item) => item.owner === 'B').connect(false); window.__callSignalingTest.start(); });
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.sent.length)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.__callSignalingTest.channels.find((item) => item.owner === 'B').connect(true));
  await expect(page.getByTestId('B')).toHaveText('incoming');
});

test('hangup while the peer is disconnected prevents a delayed incoming call', async ({ page }) => {
  await open(page, '?hold=B');
  await page.evaluate(() => window.__callSignalingTest.start());
  await expect(page.getByTestId('A')).toHaveText('calling');
  await page.evaluate(() => window.__callSignalingTest.end());
  await page.evaluate(() => window.__callSignalingTest.channels.find((item) => item.owner === 'B').connect(true));
  await page.waitForTimeout(1_800);
  await expect(page.getByTestId('B')).toHaveText('idle');
});

test('cancelling during encryption discards the completed invitation', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const control = window.__callSignalingTest;
    control.encryptionWait = new Promise((resolve) => { control.releaseEncryption = resolve; });
    control.start();
  });
  await expect(page.getByTestId('A')).toHaveText('calling');
  await page.evaluate(() => window.__callSignalingTest.end());
  await page.evaluate(() => window.__callSignalingTest.releaseEncryption());
  await page.waitForTimeout(1_800);
  await expect(page.getByTestId('B')).toHaveText('idle');
  expect(await page.evaluate(() => window.__callSignalingTest.sent.some((item) => item.event === 'incoming-call'))).toBe(false);
});

test('expired, cancelled and superseded signals cannot replace or end the current call', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const control = window.__callSignalingTest;
    await control.inject('incoming-call', { callerId: 'A', chatId: 'chat', callId: 'expired', expiresAt: Date.now() - 1 });
    await control.inject('call-rejected', { senderId: 'A', callId: 'cancelled' });
    await control.inject('incoming-call', { callerId: 'A', chatId: 'chat', callId: 'cancelled', expiresAt: Date.now() + 60_000 });
  });
  await expect(page.getByTestId('B')).toHaveText('idle');
  await page.evaluate(() => window.__callSignalingTest.start('current'));
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.inject('call-rejected', { senderId: 'A', callId: 'old' }));
  await expect(page.getByTestId('B')).toHaveText('incoming');
  expect(await page.evaluate(() => window.__callSignalingTest.B.state.callId)).toBe('current');
});

test('logging out discards an invitation still being decrypted', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const control = window.__callSignalingTest;
    control.decryptionWait = new Promise((resolve) => { control.releaseDecryption = resolve; });
    control.start();
  });
  await expect(page.getByTestId('A')).toHaveText('calling');
  await page.evaluate(() => window.__callSignalingTest.B.setUser(null));
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.channels.find((item) => item.owner === 'B').connected)).toBe(false);
  await page.evaluate(() => window.__callSignalingTest.releaseDecryption());
  await page.waitForTimeout(1_800);
  await expect(page.getByTestId('B')).toHaveText('idle');
});
