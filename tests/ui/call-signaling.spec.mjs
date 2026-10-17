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

test('a lost call acceptance is retried until the inviting application confirms receipt', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callSignalingTest.dropEvents['call-accepted'] = 1; window.__callSignalingTest.start(); });
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('A')).toHaveText('connected', { timeout: 8_000 });
  const attempts = await page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted'));
  expect(attempts).toHaveLength(2);
  expect(new Set(attempts.map(item => item.counter)).size).toBe(2);
  await page.waitForTimeout(1_800);
  expect(await page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted').length)).toBe(2);
});

test('a lost acceptance receipt is recovered by idempotent acceptance delivery', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callSignalingTest.dropEvents['call-accepted-received'] = 1; window.__callSignalingTest.start(); });
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('A')).toHaveText('connected');
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted-received').length)).toBe(2);
  await expect(page.getByTestId('A')).toHaveText('connected');
  await page.waitForTimeout(1_800);
  expect(await page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted').length)).toBe(2);
});

test('legacy peers without acceptance receipts connect while acceptance retries have a deadline', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callSignalingTest.dropEvents['call-accepted-received'] = 100; window.__callSignalingTest.start(); });
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('A')).toHaveText('connected');
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted').length)).toBeGreaterThanOrEqual(2);
  await page.clock.install();
  await page.clock.fastForward(61_000);
  const count = await page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted').length);
  await page.clock.runFor(3_000);
  expect(await page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'call-accepted').length)).toBe(count);
  await expect(page.getByTestId('A')).toHaveText('connected');
});

test('an acceptance being encrypted cannot resurrect a call after rejection or logout', async ({ page }) => {
  for (const logout of [false, true]) {
    await open(page);
    await page.evaluate(() => window.__callSignalingTest.start());
    await expect(page.getByTestId('B')).toHaveText('incoming');
    await page.evaluate(() => {
      const control = window.__callSignalingTest;
      control.acceptedWait = new Promise(resolve => { control.releaseAccepted = resolve; });
      control.accept();
    });
    await expect(page.getByTestId('B')).toHaveText('connected');
    await page.evaluate(logout => {
      const control = window.__callSignalingTest;
      if (logout) control.B.setUser(null);
      else control.reject();
    }, logout);
    await expect.poll(() => page.evaluate(() => window.__callSignalingTest.B.state.status)).toBe(logout ? 'connected' : 'ended');
    if (logout) await expect.poll(() => page.evaluate(() => window.__callSignalingTest.channels.find(item => item.owner === 'B').connected)).toBe(false);
    await page.evaluate(() => window.__callSignalingTest.releaseAccepted());
    await page.waitForTimeout(1_800);
    expect(await page.evaluate(() => window.__callSignalingTest.sent.some(item => item.event === 'call-accepted'))).toBe(false);
    await expect(page.getByTestId('A')).toHaveText(logout ? 'calling' : 'ended');
  }
});

test('an acceptance which finishes encryption after its deadline is discarded', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__callSignalingTest.start());
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => {
    const control = window.__callSignalingTest;
    control.acceptedWait = new Promise(resolve => { control.releaseAccepted = resolve; });
    control.accept();
  });
  await expect(page.getByTestId('B')).toHaveText('connected');
  await page.clock.install();
  await page.clock.fastForward(61_000);
  await page.evaluate(() => window.__callSignalingTest.releaseAccepted());
  await page.clock.runFor(2_000);
  expect(await page.evaluate(() => window.__callSignalingTest.sent.some(item => item.event === 'call-accepted'))).toBe(false);
  await expect(page.getByTestId('A')).toHaveText('calling');
});

test('accepting one group invitation keeps delivery alive for another disconnected member', async ({ page }) => {
  await open(page, '?group&hold=C');
  await page.evaluate(() => window.__callSignalingTest.start());
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('B')).toHaveText('connected');
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'incoming-call').length)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.__callSignalingTest.channels.find(item => item.owner === 'C').connect(true));
  await expect(page.getByTestId('C')).toHaveText('incoming');
  await expect(page.getByTestId('A')).toHaveText('connected');
  await expect(page.getByTestId('B')).toHaveText('connected');
});

test('declining a group invitation does not cancel another invitation or ring the declining member again', async ({ page }) => {
  await open(page, '?group&hold=C');
  await page.evaluate(() => window.__callSignalingTest.start());
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.reject());
  await expect(page.getByTestId('B')).toHaveText('ended');
  await expect.poll(() => page.evaluate(() => window.__callSignalingTest.sent.filter(item => item.event === 'incoming-call').length)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.__callSignalingTest.channels.find(item => item.owner === 'C').connect(true));
  await expect(page.getByTestId('C')).toHaveText('incoming');
  await expect(page.getByTestId('A')).toHaveText('connected');
  await expect(page.getByTestId('B')).toHaveText('ended');
});

test('ending after a lost acceptance also stops a caller which has not joined media', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callSignalingTest.dropEvents['call-accepted'] = 100; window.__callSignalingTest.start(); });
  await expect(page.getByTestId('B')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('B')).toHaveText('connected');
  await expect(page.getByTestId('A')).toHaveText('calling');
  await page.evaluate(() => window.__callSignalingTest.reject());
  await expect(page.getByTestId('A')).toHaveText('ended');
});

test('a group inviter leaving stops outstanding ringing without stopping established participants', async ({ page }) => {
  await open(page, '?group');
  await page.evaluate(() => window.__callSignalingTest.start());
  await expect(page.getByTestId('C')).toHaveText('incoming');
  await page.evaluate(() => window.__callSignalingTest.accept());
  await expect(page.getByTestId('B')).toHaveText('connected');
  await page.evaluate(() => window.__callSignalingTest.end());
  await expect(page.getByTestId('C')).toHaveText('ended');
  await expect(page.getByTestId('B')).toHaveText('connected');
});
