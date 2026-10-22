import { test, expect } from '@playwright/test';

test.use({ permissions: ['microphone', 'camera'] });
test.beforeEach(async ({ page, browserName }) => {
  await page.routeWebSocket(/.*/, () => {});
  if (browserName === 'webkit') await page.addInitScript(() => { window.__callTransportNativeMockCapture = true; });
});

async function open(page, encrypted, options = {}) {
  await page.goto(`/tests/ui/call-transport-fixture.html?group=1${encrypted ? '&encrypted=1' : ''}`);
  await expect(page.getByTestId('status-A')).toHaveText('idle');
  // Only delivery at the synthetic SDK boundary is held. The production
  // providers, peer controller, native ICE/DTLS and audio RTP remain real.
  await page.evaluate(options => {
    const control = window.__callTransportTest;
    control.heldGroupMessages = [];
    control.holdGroupSignals = false;
    const wrap = channel => {
      if (!channel.topic.endsWith(':media')) return;
      const track = channel.track.bind(channel);
      channel.track = presence => {
        const value = { ...presence };
        if (options.olderClient && value.id === 'A') delete value.sessionId;
        return track(value);
      };
      const send = channel.send.bind(channel);
      channel.send = async message => {
        const plain = message.payload?.envelope?.decoded?.payload || message.payload;
        if (plain?.senderId !== 'A') return send(message);
        if (options.olderClient) delete plain.sessionId;
        if ((message.event === 'join-group-call' && options.holdJoin)
          || (message.event === 'hangup' && options.holdHangup)
          || (message.event === 'signal' && control.holdGroupSignals)) {
          control.heldGroupMessages.push({ topic: channel.topic, message, type: plain.type || message.event });
          return 'ok';
        }
        return send(message);
      };
    };
    const push = control.channels.push.bind(control.channels);
    control.channels.push = (...channels) => { channels.forEach(wrap); return push(...channels); };
    control.releaseGroupMessages = async () => {
      const held = control.heldGroupMessages.splice(0);
      for (const { topic, message } of held) {
        for (const peer of control.channels.filter(channel => channel.connected && channel.topic === topic)) {
          for (const listener of peer.listeners.filter(item => item.type === 'broadcast' && item.event === message.event)) {
            await listener.callback({ payload: message.payload });
          }
        }
      }
    };
  }, options);
}

async function connectedAudio(page) {
  await expect.poll(() => page.evaluate(async () => (await window.__callTransportTest.snapshot()).peers
    .filter(peer => peer.connection === 'connected' && peer.incoming > 0 && peer.outgoing > 0).length),
  { timeout: 15_000 }).toBe(2);
  await expect(page.getByTestId('transport-A')).toHaveText('connected');
  await expect(page.getByTestId('transport-B')).toHaveText('connected');
}

async function start(page) {
  await page.getByRole('button', { name: 'Start A', exact: true }).click();
  await expect(page.getByTestId('status-B')).toHaveText('incoming');
  await page.getByRole('button', { name: 'Accept B', exact: true }).click();
  await connectedAudio(page);
}

async function rejoin(page, oldId) {
  await page.getByRole('button', { name: 'Start A', exact: true }).click();
  await expect(page.getByTestId('status-A')).toHaveText('connected');
  expect(await page.evaluate(() => window.__callTransportTest.apis.A.callState.callId)).not.toBe(oldId);
  await connectedAudio(page);
  await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.B.groupCallParticipants.map(peer => peer.id)))
    .toEqual(['B', 'A']);
}

for (const encrypted of [false, true]) {
  const variant = encrypted ? 'encrypted' : 'legacy';
  test(`${variant} group rejects retired SDP, ICE, join and presence and allows a fresh session`, async ({ page }) => {
    await open(page, encrypted, { holdJoin: true });
    await start(page);
    const oldId = await page.evaluate(() => window.__callTransportTest.apis.A.callState.callId);
    const oldPresence = await page.evaluate(() => window.__callTransportTest.channels.find(channel => channel.presence?.id === 'A').presence);
    await page.evaluate(() => { window.__callTransportTest.holdGroupSignals = true; });
    await page.getByRole('button', { name: 'Camera A', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.heldGroupMessages.some(message => message.type === 'offer'))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.heldGroupMessages.some(message => message.type === 'candidate'))).toBe(true);
    await page.getByRole('button', { name: 'End A', exact: true }).click();
    await expect(page.getByTestId('status-A')).toHaveText('ended');
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.B.groupCallParticipants.map(peer => peer.id))).toEqual(['B']);
    await expect(page.getByTestId('transport-B')).toHaveText('connected');
    const count = await page.evaluate(() => window.__callTransportTest.pcs.length);
    await page.evaluate(async oldPresence => {
      const control = window.__callTransportTest;
      await control.releaseGroupMessages();
      // A hangup may arrive before the corresponding presence leave. An old
      // state snapshot must not reintroduce the ended sender session either.
      const channel = control.channels.find(item => item.connected && item.topic.endsWith(':media') && item.presence?.id === 'B');
      const state = channel.presenceState.bind(channel);
      channel.presenceState = () => ({ ...state(), stale: [oldPresence] });
      try {
        for (const listener of channel.listeners.filter(item => item.type === 'presence')) listener.callback();
      } finally { channel.presenceState = state; }
      control.holdGroupSignals = false;
    }, oldPresence);
    expect(await page.evaluate(() => window.__callTransportTest.pcs.length)).toBe(count);
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.B.groupCallParticipants.map(peer => peer.id))).toEqual(['B']);
    await rejoin(page, oldId);
  });

  test(`${variant} delayed old group hangup preserves the rejoined participant`, async ({ page }) => {
    await open(page, encrypted, { holdHangup: true });
    await start(page);
    const oldId = await page.evaluate(() => window.__callTransportTest.apis.A.callState.callId);
    await page.getByRole('button', { name: 'End A', exact: true }).click();
    await expect(page.getByTestId('status-A')).toHaveText('ended');
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.heldGroupMessages.some(message => message.type === 'hangup'))).toBe(true);
    await rejoin(page, oldId);
    const before = await page.evaluate(() => window.__callTransportTest.snapshot());
    await page.evaluate(() => window.__callTransportTest.releaseGroupMessages());
    await connectedAudio(page);
    await expect.poll(() => page.evaluate(async before => {
      const after = await window.__callTransportTest.snapshot();
      return after.peers.length === before.peers.length && after.peers.every((peer, index) => peer.connection === 'closed'
        || (peer.connection === 'connected' && peer.incoming > before.peers[index].incoming && peer.outgoing > before.peers[index].outgoing));
    }, before), { timeout: 8_000 }).toBe(true);
  });

  test(`${variant} group still allows an older client without session metadata to rejoin`, async ({ page }) => {
    await open(page, encrypted, { olderClient: true });
    await start(page);
    const remoteCamera = () => page.evaluate(() => Boolean(window.__callTransportTest.apis.B.groupCallParticipants
      .find(peer => peer.id === 'A')?.cameraStream));
    for (const enabled of [true, false, true]) {
      await page.getByRole('button', { name: 'Camera A', exact: true }).click();
      await expect.poll(remoteCamera).toBe(enabled);
      await expect.poll(() => page.evaluate(() => window.__callTransportTest.pcs.every(pc => pc.signalingState === 'stable'))).toBe(true);
    }
    const restarts = await page.evaluate(() => window.__callTransportTest.pcs.reduce((total, pc) => total + pc.restarts, 0));
    const beforeRetry = await page.evaluate(() => window.__callTransportTest.snapshot());
    await page.evaluate(() => Promise.all(Object.values(window.__callTransportTest.apis).map(api => api.retryCallConnection())));
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.pcs.reduce((total, pc) => total + pc.restarts, 0))).toBeGreaterThan(restarts);
    await connectedAudio(page);
    await expect.poll(() => page.evaluate(async before => {
      const after = await window.__callTransportTest.snapshot();
      return after.peers.length === before.peers.length && after.peers.every((peer, index) =>
        peer.connection === 'connected' && peer.incoming > before.peers[index].incoming && peer.outgoing > before.peers[index].outgoing);
    }, beforeRetry), { timeout: 8_000 }).toBe(true);
    const oldId = await page.evaluate(() => window.__callTransportTest.apis.A.callState.callId);
    await page.getByRole('button', { name: 'End A', exact: true }).click();
    await expect(page.getByTestId('status-A')).toHaveText('ended');
    await expect.poll(() => page.evaluate(() => window.__callTransportTest.apis.B.groupCallParticipants.map(peer => peer.id))).toEqual(['B']);
    await rejoin(page, oldId);
  });
}
