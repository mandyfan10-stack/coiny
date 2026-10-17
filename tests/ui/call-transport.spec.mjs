import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// This fixture owns its synthetic signaling bus. Keep development hot updates
// from replacing a mounted provider while a transport scenario is in progress.
test.beforeEach(async ({ page }) => { await page.routeWebSocket(/.*/, () => {}); });

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const diagnostics = await page.evaluate(async () => {
    const control = window.__callTransportTest;
    return control ? { snapshot: await control.snapshot(), events: control.events, remainingDrops: control.drops } : null;
  }).catch(() => null);
  await writeFile(testInfo.outputPath('call-safe.json'), JSON.stringify(diagnostics, null, 2));
  await testInfo.attach('call-transport-safe-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
});

async function open(page, query = '') {
  await page.goto(`/tests/ui/call-transport-fixture.html${query}`);
  await expect(page.getByTestId('status-A')).toHaveText('idle');
  await expect(page.getByTestId('status-B')).toHaveText('idle');
}
async function start(page) {
  await page.getByRole('button', { name: 'Start A', exact: true }).click();
  await expect(page.getByTestId('status-B')).toHaveText('incoming');
  await page.getByRole('button', { name: 'Accept B', exact: true }).click();
}
async function snapshot(page) {
  return page.evaluate(() => window.__callTransportTest.snapshot());
}
async function connected(page, count = 2) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.peers.filter(peer => peer.connection === 'connected' && peer.incoming > 0 && peer.outgoing > 0).length;
  }, { timeout: 15_000 }).toBe(count);
  await expect(page.getByTestId('transport-A')).toHaveText('connected');
  await expect(page.getByTestId('transport-B')).toHaveText('connected');
}
async function advancing(page, before) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.peers.length === before.peers.length && state.peers.every((peer, index) =>
      peer.connection === 'connected' && peer.incoming > before.peers[index].incoming && peer.outgoing > before.peers[index].outgoing
      && (before.peers[index].incomingEnergy === null || peer.incomingEnergy > before.peers[index].incomingEnergy));
  }, { timeout: 8_000 }).toBe(true);
}

test('actual provider retains bidirectional audio, peer connections and microphone after profile updates', async ({ page }) => {
  await open(page);
  await start(page);
  await connected(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Profile A', exact: true }).click();
  await page.getByRole('button', { name: 'Profile B', exact: true }).click();
  await advancing(page, before);
  const after = await snapshot(page);
  expect(after.captures).toEqual([['live'], ['live']]);
  expect(after.peers.map(peer => peer.offers)).toEqual(before.peers.map(peer => peer.offers));
  await expect.poll(() => page.evaluate(() => Object.values(window.__callTransportTest.apis)
    .every(api => api.callQuality.peers.some(peer => peer.selectedPair && peer.inbound.active && peer.outbound.active))),
  { timeout: 8_000 }).toBe(true);
});

test('lost initial answer recovers after signaling rejoins without reopening microphone', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callTransportTest.drops.answer = 1; });
  await start(page);
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.drops.answer)).toBe(0);
  await page.evaluate(() => window.__callTransportTest.rejoin());
  await connected(page);
  const state = await snapshot(page);
  expect(state.peers).toHaveLength(2);
  expect(state.captures).toHaveLength(2);
  await advancing(page, state);
});

test('an SDP audio track does not report a connected call before real ICE/DTLS connects', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callTransportTest.drops.answer = 100; });
  await start(page);
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.events.some(event => event.type === 'answer'))).toBe(true);
  await expect(page.getByTestId('transport-A')).toHaveText('connecting');
  await expect(page.getByTestId('transport-B')).toHaveText('connecting');
  const blocked = await snapshot(page);
  expect(blocked.peers.every(peer => peer.connection !== 'connected')).toBe(true);
  await page.evaluate(() => { window.__callTransportTest.drops.answer = 0; window.__callTransportTest.rejoin(); });
  await connected(page);
});

test('simultaneous explicit ICE restart resolves glare and keeps both audio directions', async ({ page }) => {
  await open(page);
  await start(page);
  await connected(page);
  await page.evaluate(() => Promise.all(Object.values(window.__callTransportTest.apis).map(api => api.retryCallConnection())));
  await expect.poll(async () => (await snapshot(page)).peers.reduce((sum, peer) => sum + peer.restarts, 0)).toBe(1);
  await connected(page);
  await expect.poll(async () => (await snapshot(page)).peers.every(peer => peer.signaling === 'stable')).toBe(true);
  await advancing(page, await snapshot(page));
});

test('lost and reordered trickle candidates recover through bounded SDP retransmission', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const control = window.__callTransportTest;
    control.drops.candidate = 2;
    control.delays.offer = 150;
    control.delays.answer = 150;
  });
  await start(page);
  await connected(page);
  expect(await page.evaluate(() => window.__callTransportTest.drops.candidate)).toBe(0);
  await advancing(page, await snapshot(page));
});

test('a third member rejecting an invitation does not end the working group audio', async ({ page }) => {
  await open(page, '?group=1');
  await start(page);
  await expect(page.getByTestId('status-C')).toHaveText('incoming');
  await connected(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Reject C', exact: true }).click();
  await expect(page.getByTestId('status-C')).toHaveText('ended');
  await expect(page.getByTestId('status-A')).toHaveText('connected');
  await expect(page.getByTestId('status-B')).toHaveText('connected');
  await advancing(page, before);
});

test('group recovery restarts only the failing peer and retains healthy media', async ({ page }) => {
  await open(page, '?group=1');
  await start(page);
  await page.getByRole('button', { name: 'Accept C', exact: true }).click();
  await connected(page, 6);
  const before = await snapshot(page);
  const previousRestarts = before.peers.reduce((sum, peer) => sum + peer.restarts, 0);
  const affected = await page.evaluate(() => [0, window.__callTransportTest.counterpart(0)]);
  expect(affected[1]).toBeGreaterThanOrEqual(0);
  // Inject a browser failure notification into one actual connection. The
  // recovery itself performs a real ICE restart; the other four remain real.
  await page.evaluate(() => window.__callTransportTest.fail(0));
  await expect.poll(async () => (await snapshot(page)).peers.reduce((sum, peer) => sum + peer.restarts, 0)).toBe(previousRestarts + 1);
  await connected(page, 6);
  const after = await snapshot(page);
  expect(after.peers.filter((peer, index) => peer.restarts > before.peers[index].restarts)).toHaveLength(1);
  after.peers.forEach((peer, index) => { if (!affected.includes(index)) expect(peer.restarts).toBe(before.peers[index].restarts); });
  await advancing(page, after);
});

test('ending during delayed microphone grant stops the late track and never creates a peer', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callTransportTest.holdCapture = true; });
  await start(page);
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.captures.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.captures.every(capture => typeof capture.release === 'function'))).toBe(true);
  await page.getByRole('button', { name: 'End A', exact: true }).click();
  await expect(page.getByTestId('status-A')).toHaveText('ended');
  await expect(page.getByTestId('status-B')).toHaveText('ended');
  await page.evaluate(() => window.__callTransportTest.captures.forEach(capture => capture.release()));
  await expect.poll(async () => (await snapshot(page)).captures.flat().every(state => state === 'ended')).toBe(true);
  expect((await snapshot(page)).peers).toHaveLength(0);
});


test('real audio worklet toggles preserve audio and mute and stop the hidden microphone on hangup', async ({ page }) => {
  await open(page);
  await start(page);
  await connected(page);
  await page.getByRole('button', { name: 'Mute A', exact: true }).click();
  await page.getByRole('button', { name: 'Voice A', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.A.voiceEnhancementEnabled)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.A.callState.muted)).toBe(true);
  expect(await page.evaluate(() => window.__callTransportTest.captures.every(capture => capture.stream.getAudioTracks()
    .every(track => track.readyState === 'live')))).toBe(true);
  await page.getByRole('button', { name: 'Mute A', exact: true }).click();
  await advancing(page, await snapshot(page));
  await page.getByRole('button', { name: 'Voice A', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.A.voiceEnhancementEnabled)).toBe(false);
  await advancing(page, await snapshot(page));
  await page.getByRole('button', { name: 'Voice A', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.A.voiceEnhancementEnabled)).toBe(true);
  await page.getByRole('button', { name: 'End A', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).captures.flat().every(state => state === 'ended')).toBe(true);
});


test('lost call acceptance is retransmitted and both users establish real audio', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callTransportTest.drops['call-accepted'] = 1; });
  await start(page);
  await connected(page);
  const state = await snapshot(page);
  expect(state.peers).toHaveLength(2);
  await expect(page.getByTestId('status-A')).toHaveText('connected');
  await expect(page.getByTestId('status-B')).toHaveText('connected');
  await advancing(page, state);
});


test('encrypted hangup finishes after media teardown while encryption was still awaiting', async ({ page }) => {
  await open(page, '?encrypted=1');
  await start(page);
  await connected(page);
  await page.evaluate(() => {
    window.__callTransportTest.holdHangup = true;
    window.__callTransportTest.drops['call-rejected'] = 100; // Isolate the encrypted media-channel terminal fallback.
  });
  await page.getByRole('button', { name: 'End A', exact: true }).click();
  await expect(page.getByTestId('status-A')).toHaveText('ended');
  await expect(page.getByTestId('status-B')).toHaveText('connected');
  await expect.poll(() => page.evaluate(() => typeof window.__callTransportTest.releaseEncryption)).toBe('function');
  await page.evaluate(() => window.__callTransportTest.releaseEncryption());
  await expect(page.getByTestId('status-B')).toHaveText('ended');
});

for (const change of ['remove', 'membership']) {
  test(`active call is closed when its chat ${change === 'remove' ? 'is removed' : 'loses account membership'}`, async ({ page }) => {
    await open(page, change === 'membership' ? '?group=1' : '');
    await start(page);
    await connected(page);
    await page.evaluate(change => window.__callTransportTest.chatUpdates.A(change), change);
    await expect(page.getByTestId('status-A')).toHaveText('ended');
    await expect.poll(async () => (await snapshot(page)).peers.filter(peer => peer.connection === 'closed').length).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await snapshot(page)).captures.flat().filter(state => state === 'ended').length).toBeGreaterThanOrEqual(1);
  });
}

for (const kind of ['Camera', 'Screen']) {
  test(`late ${kind.toLowerCase()} permission after hangup cannot restore media or leak a track`, async ({ page }) => {
    await open(page);
    await start(page);
    await connected(page);
    await page.evaluate(() => { window.__callTransportTest.holdVideo = true; });
    await page.getByRole('button', { name: `${kind} A`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.captures.filter(capture => capture.kind).length)).toBe(1);
    await page.getByRole('button', { name: 'End A', exact: true }).click();
    await expect(page.getByTestId('status-A')).toHaveText('ended');
    await page.evaluate(() => window.__callTransportTest.captures.filter(capture => capture.kind).forEach(capture => capture.release()));
    await expect.poll(async () => (await snapshot(page)).captures.flat().every(state => state === 'ended')).toBe(true);
    expect(await page.evaluate(() => window.__callTransportTest.apis.A.localVideoStream)).toBe(null);
    expect(await page.evaluate(() => window.__callTransportTest.apis.A.isScreenSharing)).toBe(false);
  });
}

test('quality details fit narrow and low screens and expose keyboard focus', async ({ page }) => {
  for (const width of [320, 390, 640]) {
    await page.setViewportSize({ width, height: 360 });
    await open(page);
    const quality = page.getByTestId('quality-A');
    await quality.locator('summary').focus();
    await expect(quality.locator('summary')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(quality.locator('dl')).toBeVisible();
    expect(await quality.evaluate(element => {
      const rect = element.querySelector('.call-quality').getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
    await expect(quality).toContainText('RTT — время туда и обратно.');
    await expect(quality).toContainText('Определяется');
  }
});

test('callee hanging up while every acceptance is lost also cancels the still-ringing caller', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__callTransportTest.drops['call-accepted'] = 100; });
  await start(page);
  await expect(page.getByTestId('status-A')).toHaveText('calling');
  await expect(page.getByTestId('status-B')).toHaveText('connected');
  await page.getByRole('button', { name: 'End B', exact: true }).click();
  await expect(page.getByTestId('status-A')).toHaveText('ended');
  await expect(page.getByTestId('status-B')).toHaveText('ended');
});

test('group host hanging up cancels an unanswered invitation without waiting for ring timeout', async ({ page }) => {
  await open(page, '?group=1');
  await start(page);
  await connected(page);
  await expect(page.getByTestId('status-C')).toHaveText('incoming');
  await page.getByRole('button', { name: 'End A', exact: true }).click();
  await expect(page.getByTestId('status-A')).toHaveText('ended');
  await expect(page.getByTestId('status-C')).toHaveText('ended');
});

for (const group of [false, true]) {
  test(`${group ? 'group' : 'personal'} camera off clears the remote video presentation and preserves audio`, async ({ page }) => {
    await open(page, group ? '?group=1' : '');
    await start(page);
    await connected(page);
    const originalPeerCount = (await snapshot(page)).peers.length;
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.getByRole('button', { name: 'Camera A', exact: true }).click();
      await expect.poll(() => page.evaluate(group => {
        const remote = window.__callTransportTest.apis.B;
        if (!group) return Boolean(remote.remoteVideoStream);
        const participant = remote.groupCallParticipants.find(item => item.id === 'A');
        return Boolean(participant?.cameraStream && participant?.videoStream && participant?.isCameraActive);
      }, group)).toBe(true);
      await page.getByRole('button', { name: 'Camera A', exact: true }).click();
      await expect.poll(() => page.evaluate(group => {
        const remote = window.__callTransportTest.apis.B;
        if (!group) return remote.remoteVideoStream === null;
        const participant = remote.groupCallParticipants.find(item => item.id === 'A');
        return Boolean(participant && participant.cameraStream === null && participant.videoStream === null && participant.isCameraActive === false);
      }, group)).toBe(true);
      await advancing(page, await snapshot(page));
      expect((await snapshot(page)).peers).toHaveLength(originalPeerCount);
    }
  });
}
