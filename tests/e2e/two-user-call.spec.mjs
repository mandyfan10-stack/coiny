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

test('two users establish and finish a WebRTC audio call with remote media', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const contextOptions = {
    permissions: ['microphone', 'camera'],
  };
  const firstContext = await browser.newContext(contextOptions);
  const secondContext = await browser.newContext(contextOptions);
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const pageErrors = [];
  const diagnostics = [];
  const startedAt = Date.now();

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

    const accept = secondPage.locator('.call-accept[title="Ответить на звонок"]');
    await expect(accept).toBeVisible({ timeout: 30_000 });
    await accept.click();

    // Connected UI: duration timer (MM:SS or H:MM:SS)
    const connectedTimer = /^(\d{1,2}:)?\d{2}:\d{2}$/;
    await expect(firstPage.locator('.call-status-subtitle')).toHaveText(connectedTimer, { timeout: 45_000 });
    await expect(secondPage.locator('.call-status-subtitle')).toHaveText(connectedTimer, { timeout: 45_000 });

    // Media path: at least one side should attach a live remote audio feed
    // (fake media devices are enabled in playwright.config.mjs).
    await expect
      .poll(async () => {
        const a = await countRemoteAudioFeeds(firstPage);
        const b = await countRemoteAudioFeeds(secondPage);
        return a + b;
      }, { timeout: 30_000, message: 'expected live webrtc-remote-audio-feed tracks' })
      .toBeGreaterThan(0);

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
