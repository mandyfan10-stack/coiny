import { test, expect } from '@playwright/test';

for (const operation of ['add-unrelated-chat', 'reload-sender']) {
  test(`new calls keep working after ${operation} while the receiver keeps its subscription`, async ({ page }) => {
    const errors = [];
    page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
    await page.routeWebSocket(/.*/, () => {});
    await page.goto('/tests/ui/call-signal-session-fixture.html');
    await expect(page.getByTestId('A')).toHaveText('idle');
    await expect(page.getByTestId('B')).toHaveText('idle');
    const receiverSubscription = await page.evaluate(() => window.__callSignalSessionTest.B.channels.current[0].fixtureId);

    // One completed call leaves real received counters at the still-mounted B.
    await page.evaluate(() => window.__callSignalSessionTest.start('previous-call'));
    await expect(page.getByTestId('B')).toHaveText('incoming');
    await page.evaluate(() => window.__callSignalSessionTest.accept());
    await expect(page.getByTestId('A')).toHaveText('connected');
    await page.evaluate(() => window.__callSignalSessionTest.end());
    await expect(page.getByTestId('B')).toHaveText('ended');
    await page.evaluate(() => window.__callSignalSessionTest.reset());
    await expect(page.getByTestId('A')).toHaveText('idle');
    await expect(page.getByTestId('B')).toHaveText('idle');

    const originalSenderChannel = await page.evaluate(() => window.__callSignalSessionTest.A.channels.current[0].fixtureId);
    await page.evaluate(operation => {
      const control = window.__callSignalSessionTest;
      if (operation === 'reload-sender') control.reloadSender();
      else control.addUnrelatedChat();
    }, operation);
    await expect.poll(() => page.evaluate(() => window.__callSignalSessionTest.A.channels.current[0]?.fixtureId)).not.toBe(originalSenderChannel);
    expect(await page.evaluate(() => window.__callSignalSessionTest.B.channels.current[0].fixtureId)).toBe(receiverSubscription);

    await page.evaluate(() => window.__callSignalSessionTest.start('fresh-call'));
    await expect(page.getByTestId('B')).toHaveText('incoming');
    expect(await page.evaluate(() => window.__callSignalSessionTest.B.state.callId)).toBe('fresh-call');
    expect(await page.evaluate(() => window.__callSignalSessionTest.sent.filter(item => item.event === 'incoming-call'
      && item.payload.callId === 'fresh-call').length)).toBe(1);
    await page.evaluate(() => window.__callSignalSessionTest.accept());
    await expect(page.getByTestId('A')).toHaveText('connected');
    await page.evaluate(() => window.__callSignalSessionTest.end());
    await expect(page.getByTestId('B')).toHaveText('ended');
    expect(errors).toEqual([]);
  });
}
