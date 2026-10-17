import { test, expect } from '@playwright/test';
import { loadE2eAccounts, loginAndUnlock, openPersonalChat } from './helpers.mjs';
import { observeCallSignaling, saveCallDiagnostics } from './call-diagnostics.mjs';

const qa = loadE2eAccounts();

test.skip(
  qa.missing.length > 0,
  `Live two-user E2E requires: ${qa.missing.join(', ')}`,
);

/**
 * Count live remote audio tracks attached by CallContext
 * (hidden <audio class="webrtc-remote-audio-feed"> elements).
 */
async function countRemoteAudioFeeds(page) {
  return page.evaluate(() => {
    const feeds = [...document.querySelectorAll('audio.webrtc-remote-audio-feed')];
    return feeds.filter((el) => {
      const stream = el.srcObject;
      if (!stream || typeof stream.getAudioTracks !== 'function') return false;
      return stream.getAudioTracks().some((track) => track.readyState === 'live');
    }).length;
  });
}

// Observe native RTP in the test context only. Never expose connection objects
// or raw stats (addresses, SDP and identifiers) through the application UI.
async function observeNativeAudio(context) {
  await context.addInitScript(() => {
    const connections = [];
    const NativePeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(NativePeerConnection, {
      construct(Target, args) {
        const connection = new Target(...args);
        connections.push(connection);
        return connection;
      }
    });
    window.__testAudioCounters = async () => {
      let received = 0, sent = 0;
      const active = connections.filter(connection => connection.connectionState !== 'closed');
      for (const connection of active) {
        const report = await connection.getStats();
        report.forEach(stat => {
          if ((stat.kind ?? stat.mediaType) !== 'audio') return;
          if (stat.type === 'inbound-rtp') received += stat.packetsReceived || 0;
          if (stat.type === 'outbound-rtp') sent += stat.packetsSent || 0;
        });
      }
      return { received, sent, connected: active.some(connection => connection.connectionState === 'connected') };
    };
  });
}
const audioCounters = page => page.evaluate(() => window.__testAudioCounters());

for (const delayedRecipient of [false, true]) {
test(`two users establish and finish a WebRTC audio call with remote media${delayedRecipient ? ' after delayed recipient subscription' : ''}`, async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const contextOptions = {
    permissions: ['microphone', 'camera'],
  };
  const firstContext = await browser.newContext(contextOptions);
  const secondContext = await browser.newContext(contextOptions);
  await Promise.all([observeNativeAudio(firstContext), observeNativeAudio(secondContext)]);
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const pageErrors = [];
  const diagnostics = [];
  const startedAt = Date.now();
  const heldJoins = [];
  let holdSubscriptions = delayedRecipient;
  if (delayedRecipient) {
    await secondPage.routeWebSocket('**/realtime/v1/websocket*', (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        let frame;
        if (typeof message === 'string') {
          try { frame = JSON.parse(message); } catch { /* Binary or non-JSON message. */ }
        }
        if (holdSubscriptions && frame?.[3] === 'phx_join'
          && String(frame[2]).startsWith('realtime:call:chat:') && !String(frame[2]).endsWith(':media')) {
          heldJoins.push(() => server.send(message));
        } else server.send(message);
      });
    });
  }

  for (const [label, page] of [['A', firstPage], ['B', secondPage]]) {
    observeCallSignaling(page, label, diagnostics, startedAt);
    page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  }

  try {
    await loginAndUnlock(firstPage, qa.first);
    await loginAndUnlock(secondPage, qa.second);

    await openPersonalChat(firstPage, qa.second.username);
    await firstPage.locator('.chat-header-btn[title="Информация"]').click();
    await firstPage.getByTestId('start-call').or(firstPage.locator('.info-action-btn[title="Звонок"], .quick-action-item[title="Звонок"]')).click({ timeout: 15_000 });
    if (delayedRecipient) {
      expect(heldJoins.length, 'recipient invitation channels must actually be delayed').toBeGreaterThan(0);
      await expect(secondPage.locator('.call-accept')).toBeHidden();
      await secondPage.waitForTimeout(4_500);
      holdSubscriptions = false;
      heldJoins.splice(0).forEach((send) => send());
    }

    const accept = secondPage.locator('.call-accept[title="Ответить на звонок"]');
    await expect(accept).toBeVisible({ timeout: 30_000 });
    await accept.click();

    // Connected UI: duration timer (MM:SS or H:MM:SS)
    const connectedTimer = /^(\d{1,2}:)?\d{2}:\d{2}$/;
    await expect(firstPage.locator('.call-status-subtitle')).toHaveText(connectedTimer, { timeout: 45_000 });
    await expect(secondPage.locator('.call-status-subtitle')).toHaveText(connectedTimer, { timeout: 45_000 });

    // Both participants must actually send and receive RTP. An SDP track or
    // connected UI alone cannot prove a working two-way audio path.
    await expect
      .poll(async () => {
        const peers = await Promise.all([audioCounters(firstPage), audioCounters(secondPage)]);
        return peers.every(peer => peer.connected && peer.received > 0 && peer.sent > 0);
      }, { timeout: 30_000, message: 'expected bidirectional native audio RTP at both participants' })
      .toBe(true);
    const before = await Promise.all([audioCounters(firstPage), audioCounters(secondPage)]);
    await expect.poll(async () => {
      const peers = await Promise.all([audioCounters(firstPage), audioCounters(secondPage)]);
      return peers.every((peer, index) => peer.connected
        && peer.received > before[index].received + 50 && peer.sent > before[index].sent + 50);
    }, { timeout: 15_000, message: 'both audio directions must continue advancing' }).toBe(true);
    const after = await Promise.all([audioCounters(firstPage), audioCounters(secondPage)]);
    after.forEach((peer, index) => diagnostics.push({
      peer: index ? 'B' : 'A', ms: Date.now() - startedAt, kind: 'audio-rtp-advancing',
      receivedDelta: peer.received - before[index].received, sentDelta: peer.sent - before[index].sent
    }));
    await firstPage.locator('.call-quality summary').click();
    await expect(firstPage.locator('.call-quality')).toContainText('Пинг (RTT)');

    // Overlay stays active while connected
    await expect(firstPage.locator('.call-overlay-wrapper.active')).toBeVisible();
    await expect(secondPage.locator('.call-overlay-wrapper.active')).toBeVisible();

    await firstPage.locator('.call-hangup[title="Завершить звонок"]').click();
    await expect(secondPage.locator('.call-overlay-wrapper.active')).toBeHidden({ timeout: 15_000 });
    await expect(firstPage.locator('.call-overlay-wrapper.active')).toBeHidden({ timeout: 15_000 });

    // Remote audio elements cleaned up after hangup
    await expect
      .poll(async () => (await countRemoteAudioFeeds(firstPage)) + (await countRemoteAudioFeeds(secondPage)), {
        timeout: 10_000,
      })
      .toBe(0);

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  } finally {
    await saveCallDiagnostics(testInfo, diagnostics);
    await Promise.all([firstContext.close(), secondContext.close()]);
  }
});
}
