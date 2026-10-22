import { test, expect } from '@playwright/test';

test.use({ permissions: ['microphone', 'camera'] });
test.beforeEach(async ({ page, browserName }) => {
  await page.routeWebSocket(/.*/, () => {});
  if (browserName === 'webkit') await page.addInitScript(() => { window.__callTransportNativeMockCapture = true; });
});

async function openCall(page, group) {
  await page.goto(`/tests/ui/call-transport-fixture.html?encrypted=1${group ? '&group=1' : ''}`);
  await expect(page.getByTestId('status-A')).toHaveText('idle');
  await page.getByRole('button', { name: 'Start A', exact: true }).click();
  await expect(page.getByTestId('status-B')).toHaveText('incoming');
  await page.getByRole('button', { name: 'Accept B', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await window.__callTransportTest.snapshot()).peers
    .filter(peer => peer.connection === 'connected' && peer.incoming > 0 && peer.outgoing > 0).length),
  { timeout: 15_000 }).toBe(2);
}

function remoteKind(page, group) {
  return page.evaluate(group => {
    const remote = window.__callTransportTest.apis.B;
    if (!group) return remote.remoteVideoStream ? remote.callState.isRemoteScreenSharing ? 'screen' : 'camera' : null;
    const member = remote.groupCallParticipants.find(item => item.id === 'A');
    return member?.screenStream ? 'screen' : member?.cameraStream ? 'camera' : null;
  }, group);
}

for (const group of [false, true]) {
  for (const nextSource of ['camera', 'screen']) {
    test(`${group ? 'group' : 'personal'} delayed camera stop preserves a newer ${nextSource}`, async ({ page }) => {
      await openCall(page, group);
      await page.getByRole('button', { name: 'Camera A', exact: true }).click();
      await expect.poll(() => remoteKind(page, group)).toBe('camera');
      await page.evaluate(() => {
        const control = window.__callTransportTest;
        control.deliveredOldStops = 0;
        control.delays['video-stopped'] = 2_000;
        for (const channel of control.channels.filter(item => item.topic.endsWith(':media'))) {
          channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
            const plain = payload?.envelope?.decoded?.payload || payload;
            if (plain?.type === 'video-stopped') {
              // Let the provider process the same delivered signal and render
              // before checking that it did not clear the current source.
              requestAnimationFrame(() => requestAnimationFrame(() => { control.deliveredOldStops++; }));
            }
          });
        }
      });
      await page.getByRole('button', { name: 'Camera A', exact: true }).click();
      await expect.poll(() => remoteKind(page, group)).toBe(null);
      await page.getByRole('button', { name: nextSource === 'screen' ? 'Screen A' : 'Camera A', exact: true }).click();
      await expect.poll(() => remoteKind(page, group)).toBe(nextSource);
      const before = await page.evaluate(() => window.__callTransportTest.snapshot());
      await expect.poll(() => page.evaluate(() => window.__callTransportTest.deliveredOldStops)).toBe(1);
      expect(await remoteKind(page, group)).toBe(nextSource);
      expect(await page.evaluate(() => window.__callTransportTest.apis.A.localVideoStream.getVideoTracks()[0].readyState)).toBe('live');
      await expect.poll(() => page.evaluate(async before => (await window.__callTransportTest.snapshot()).peers
        .every((peer, index) => peer.connection === 'connected' && peer.incoming > before.peers[index].incoming
          && peer.outgoing > before.peers[index].outgoing), before)).toBe(true);
    });
  }
}
