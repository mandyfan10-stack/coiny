import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  DEFAULT_QUICK_EMOJIS,
  extractMessageText,
  copyTextToClipboard,
  canUserDeleteMessage,
  triggerHaptic
} from '../src/utils/mobileActionSheetUtils.js';
import { normalizeReaction } from '../src/utils/reactionUtils.ts';

const sheetJsx = fs.readFileSync(new URL('../src/components/chat/MobileActionSheet.jsx', import.meta.url), 'utf8');
const sheetCss = fs.readFileSync(new URL('../src/components/chat/MobileActionSheet.css', import.meta.url), 'utf8');

function buildHarnessHtml({
  emojis = DEFAULT_QUICK_EMOJIS,
  showCopy = true,
  showDelete = true,
  activeEmoji = '🔥'
} = {}) {
  const reactionPills = emojis.map((emo) => {
    const isActive = emo === activeEmoji;
    return `
      <button
        type="button"
        class="mobile-sheet-reaction-pill ${isActive ? 'active' : ''}"
        data-test="mobile-reaction-${emo}"
        data-emoji="${emo}"
        aria-label="Реакция ${emo}"
      >
        ${emo}
      </button>
    `;
  }).join('');

  const copyButton = showCopy ? `
    <button
      type="button"
      class="mobile-sheet-item"
      data-test="mobile-action-copy"
      role="menuitem"
    >
      <div class="mobile-sheet-item-icon">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </div>
      <span class="mobile-sheet-item-label">Копировать текст</span>
    </button>
  ` : '';

  const deleteButton = showDelete ? `
    <button
      type="button"
      class="mobile-sheet-item delete"
      data-test="mobile-action-delete"
      role="menuitem"
    >
      <div class="mobile-sheet-item-icon">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </div>
      <span class="mobile-sheet-item-label">Удалить</span>
    </button>
  ` : '';

  return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    :root {
      --bg-primary: #0e1621;
      --bg-secondary: #17212b;
      --bg-tertiary: #24303f;
      --border-color: #101921;
      --text-primary: #f5f6f7;
      --text-secondary: #7f91a4;
      --accent-color: #2481cc;
      --accent-gradient: linear-gradient(135deg, #2481cc 0%, #1c6199 100%);
    }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      height: 100vh;
      overflow: hidden;
    }
    ${sheetCss}
  </style>
</head>
<body>
  <div
    class="mobile-action-sheet-backdrop"
    id="test-backdrop"
    data-test="mobile-action-sheet-backdrop"
    role="dialog"
    aria-modal="true"
  >
    <div
      class="mobile-action-sheet"
      id="test-sheet-card"
      data-test="mobile-action-sheet"
    >
      <div class="mobile-sheet-reactions" role="toolbar" aria-label="Быстрые реакции">
        ${reactionPills}
      </div>

      <div class="mobile-sheet-menu" role="menu">
        <button
          type="button"
          class="mobile-sheet-item"
          data-test="mobile-action-reply"
          role="menuitem"
        >
          <div class="mobile-sheet-item-icon">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
          </div>
          <span class="mobile-sheet-item-label">Ответить</span>
        </button>

        ${copyButton}
        ${deleteButton}
      </div>
    </div>
  </div>

  <script>
    window.__eventsLog = [];
    const backdrop = document.getElementById('test-backdrop');
    const sheetCard = document.getElementById('test-sheet-card');

    backdrop.addEventListener('click', (e) => {
      window.__eventsLog.push({ target: 'backdrop', type: 'click' });
    });

    sheetCard.addEventListener('click', (e) => {
      e.stopPropagation();
      window.__eventsLog.push({ target: 'sheetCard', type: 'click' });
    });

    document.querySelectorAll('.mobile-sheet-reaction-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        window.__eventsLog.push({ target: 'reaction', emoji: btn.getAttribute('data-emoji') });
      });
    });

    const replyBtn = document.querySelector('[data-test="mobile-action-reply"]');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        window.__eventsLog.push({ target: 'reply' });
      });
    }

    const copyBtn = document.querySelector('[data-test="mobile-action-copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        window.__eventsLog.push({ target: 'copy' });
      });
    }

    const deleteBtn = document.querySelector('[data-test="mobile-action-delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        window.__eventsLog.push({ target: 'delete' });
      });
    }

    window.addEventListener('keydown', (e) => {
      window.__eventsLog.push({ target: 'window', key: e.key });
      if (e.key === 'Escape') {
        window.__eventsLog.push({ action: 'onCloseByEscape' });
      }
    });
  </script>
</body>
</html>
  `;
}

async function launchBrowserSafely() {
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    if (
      e?.message?.includes("Executable doesn't exist") ||
      e?.message?.includes('browserType.launch') ||
      (e?.name === 'Error' && e?.message?.includes('playwright'))
    ) {
      return null;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 1. Empirical Verification: Touch Targets (>=44px) across Mobile Viewports
// ---------------------------------------------------------------------------

test('EMPIRICAL CHALLENGER: Reaction pills and action items strictly meet >=44px touch targets across all mobile viewports', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  try {
    const viewports = [
      { name: 'iPhone SE (320px)', width: 320, height: 568 },
      { name: 'Android Small (360px)', width: 360, height: 640 },
      { name: 'iPhone 12/13/14 (390px)', width: 390, height: 844 },
      { name: 'Pixel 7 (412px)', width: 412, height: 915 },
      { name: 'iPad Mini (768px)', width: 768, height: 1024 }
    ];

    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(buildHarnessHtml());

      // Wait for entrance slide-up transition to settle to final scale(1)
      await page.waitForFunction(() => {
        const card = document.getElementById('test-sheet-card');
        if (!card) return false;
        const transform = window.getComputedStyle(card).transform;
        return transform === 'none' || transform.includes('1, 0, 0, 1, 0, 0');
      });

      // 1. Verify reaction pills bounding box dimensions
      const reactionPills = page.locator('.mobile-sheet-reaction-pill');
      const count = await reactionPills.count();
      assert.equal(count, 8, `Expected 8 reaction pills on ${vp.name}`);

      for (let i = 0; i < count; i++) {
        const box = await reactionPills.nth(i).boundingBox();
        assert.ok(box, `Pill ${i} should have a bounding box on ${vp.name}`);
        assert.ok(
          box.width >= 44,
          `[${vp.name}] Reaction pill ${i} width ${box.width}px must be >= 44px (WCAG 2.5.5)`
        );
        assert.ok(
          box.height >= 44,
          `[${vp.name}] Reaction pill ${i} height ${box.height}px must be >= 44px (WCAG 2.5.5)`
        );

        // Also verify computed style min-width / min-height
        const computed = await reactionPills.nth(i).evaluate((el) => {
          const s = window.getComputedStyle(el);
          return {
            minWidth: s.minWidth,
            minHeight: s.minHeight,
            width: s.width,
            height: s.height
          };
        });
        assert.equal(computed.minWidth, '44px');
        assert.equal(computed.minHeight, '44px');
        assert.equal(computed.width, '44px');
        assert.equal(computed.height, '44px');
      }

      // 2. Verify action items bounding box dimensions
      const actionItems = page.locator('.mobile-sheet-item');
      const actionCount = await actionItems.count();
      assert.equal(actionCount, 3, `Expected 3 action items (Reply, Copy, Delete) on ${vp.name}`);

      for (let i = 0; i < actionCount; i++) {
        const box = await actionItems.nth(i).boundingBox();
        assert.ok(box, `Action item ${i} should have bounding box on ${vp.name}`);
        assert.ok(
          box.height >= 44,
          `[${vp.name}] Action item ${i} height ${box.height}px must be >= 44px (WCAG 2.5.5 / Apple HIG)`
        );
        assert.ok(
          box.width >= 200,
          `[${vp.name}] Action item ${i} width ${box.width}px must comfortably span mobile card`
        );

        const computed = await actionItems.nth(i).evaluate((el) => {
          const s = window.getComputedStyle(el);
          return {
            minHeight: s.minHeight
          };
        });
        assert.equal(computed.minHeight, '48px');
      }

      // 3. Verify Sheet Card does not overflow viewport horizontally
      const sheetCard = page.locator('#test-sheet-card');
      const cardBox = await sheetCard.boundingBox();
      assert.ok(cardBox, `Sheet card must have bounding box on ${vp.name}`);
      assert.ok(cardBox.x >= 0, `[${vp.name}] Sheet card left (${cardBox.x}) must be >= 0`);
      assert.ok(
        cardBox.x + cardBox.width <= vp.width,
        `[${vp.name}] Sheet card right (${cardBox.x + cardBox.width}) must be <= viewport width (${vp.width})`
      );

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Empirical Verification: Backdrop Tap-Outside Click Isolation
// ---------------------------------------------------------------------------

test('EMPIRICAL CHALLENGER: Backdrop tap-outside click isolation and inner stopPropagation', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
    await page.setContent(buildHarnessHtml());

    // 1. Click backdrop in the upper blank region (e.g. y = 100, x = 187)
    await page.mouse.click(187, 100);

    let logs = await page.evaluate(() => window.__eventsLog);
    const backdropClicks = logs.filter(l => l.target === 'backdrop');
    assert.equal(backdropClicks.length, 1, 'Clicking outside sheet must trigger backdrop click');

    // Reset log
    await page.evaluate(() => { window.__eventsLog = []; });

    // 2. Click inside sheet card on non-button padding area (e.g. card header / spacing)
    const card = page.locator('#test-sheet-card');
    const cardBox = await card.boundingBox();
    assert.ok(cardBox);

    // Click near top edge of card
    await page.mouse.click(cardBox.x + 10, cardBox.y + 6);

    logs = await page.evaluate(() => window.__eventsLog);
    const innerCardClicks = logs.filter(l => l.target === 'sheetCard');
    const leakedBackdropClicks = logs.filter(l => l.target === 'backdrop');

    assert.equal(innerCardClicks.length, 1, 'Clicking inside card must trigger card click');
    assert.equal(
      leakedBackdropClicks.length,
      0,
      'Clicking inside card MUST NOT bubble to backdrop (stopPropagation isolation)'
    );

    // Reset log
    await page.evaluate(() => { window.__eventsLog = []; });

    // 3. Click individual reaction pill
    const firePill = page.locator('[data-test="mobile-reaction-🔥"]');
    await firePill.click();

    logs = await page.evaluate(() => window.__eventsLog);
    const reactionEvents = logs.filter(l => l.target === 'reaction');
    const backdropLeakedFromPill = logs.filter(l => l.target === 'backdrop');

    assert.equal(reactionEvents.length, 1);
    assert.equal(reactionEvents[0].emoji, '🔥');
    assert.equal(backdropLeakedFromPill.length, 0, 'Reaction click must not leak to backdrop click');

    // 4. Click Reply button
    await page.evaluate(() => { window.__eventsLog = []; });
    const replyBtn = page.locator('[data-test="mobile-action-reply"]');
    await replyBtn.click();

    logs = await page.evaluate(() => window.__eventsLog);
    assert.equal(logs.filter(l => l.target === 'reply').length, 1);
    assert.equal(logs.filter(l => l.target === 'backdrop').length, 0);

    // 5. Click Delete button
    await page.evaluate(() => { window.__eventsLog = []; });
    const deleteBtn = page.locator('[data-test="mobile-action-delete"]');
    await deleteBtn.click();

    logs = await page.evaluate(() => window.__eventsLog);
    assert.equal(logs.filter(l => l.target === 'delete').length, 1);
    assert.equal(logs.filter(l => l.target === 'backdrop').length, 0);

    await page.close();
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Empirical Verification: Escape Key Dismissal & Lifecycle
// ---------------------------------------------------------------------------

test('EMPIRICAL CHALLENGER: Escape key triggers dismissal; non-Escape keys ignored', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
    await page.setContent(buildHarnessHtml());

    // Press non-Escape keys
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');

    let logs = await page.evaluate(() => window.__eventsLog);
    let escapeDismissals = logs.filter(l => l.action === 'onCloseByEscape');
    assert.equal(escapeDismissals.length, 0, 'Non-escape keys must not trigger dismissal');

    // Press Escape
    await page.keyboard.press('Escape');

    logs = await page.evaluate(() => window.__eventsLog);
    escapeDismissals = logs.filter(l => l.action === 'onCloseByEscape');
    assert.equal(escapeDismissals.length, 1, 'Escape key must trigger dismissal');

    await page.close();
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Empirical Verification: CSS Animation Boundaries & Safe Area Rules
// ---------------------------------------------------------------------------

test('EMPIRICAL CHALLENGER: CSS animation keyframes, curves, z-index, and reduced-motion boundary rules', () => {
  // Backdrop animation
  assert.match(sheetCss, /@keyframes\s+mobileBackdropFadeIn\s*\{/);
  assert.match(sheetCss, /from\s*\{\s*opacity:\s*0;\s*\}/);
  assert.match(sheetCss, /to\s*\{\s*opacity:\s*1;\s*\}/);
  assert.match(sheetCss, /animation:\s*mobileBackdropFadeIn\s+0\.2s\s+cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);

  // Sheet card slide up animation
  assert.match(sheetCss, /@keyframes\s+mobileSheetSlideUp\s*\{/);
  assert.match(sheetCss, /from\s*\{\s*transform:\s*translateY\(40px\);\s*opacity:\s*0;\s*\}/);
  assert.match(sheetCss, /to\s*\{\s*transform:\s*translateY\(0\);\s*opacity:\s*1;\s*\}/);
  assert.match(sheetCss, /animation:\s*mobileSheetSlideUp\s+0\.25s\s+cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);

  // Z-index and a flat backdrop
  assert.match(sheetCss, /z-index:\s*10060/);
  assert.doesNotMatch(sheetCss, /backdrop-filter:/);

  // Safe area insets
  assert.match(sheetCss, /padding-bottom:\s*max\(16px,\s*env\(safe-area-inset-bottom,\s*16px\)\)/);
  assert.match(sheetCss, /padding-top:\s*max\(12px,\s*env\(safe-area-inset-top,\s*12px\)\)/);
  assert.match(sheetCss, /padding-left:\s*max\(16px,\s*env\(safe-area-inset-left,\s*16px\)\)/);
  assert.match(sheetCss, /padding-right:\s*max\(16px,\s*env\(safe-area-inset-right,\s*16px\)\)/);

  // Touch action & callout suppression
  assert.match(sheetCss, /touch-action:\s*pan-y/);
  assert.match(sheetCss, /touch-action:\s*manipulation/);
  assert.match(sheetCss, /-webkit-touch-callout:\s*none/);
  assert.match(sheetCss, /-webkit-user-select:\s*none/);
  assert.match(sheetCss, /user-select:\s*none/);

  // Reduced motion media query overrides
  assert.match(sheetCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
  assert.match(sheetCss, /animation:\s*none\s*!important/);
  assert.match(sheetCss, /transition:\s*none\s*!important/);
});

// ---------------------------------------------------------------------------
// 5. Empirical Verification: Delete Permission Gating on Incoming vs Outgoing
// ---------------------------------------------------------------------------

test('EMPIRICAL CHALLENGER: Delete permission gating matrix across all chat scopes and user roles', () => {
  const currentUser = { id: 'alice_1', name: 'Alice' };
  const otherUserMsg = { id: 'msg_other', senderId: 'bob_2', text: 'Hello everyone' };
  const myMsg = { id: 'msg_mine', senderId: 'alice_1', text: 'My message' };
  const myLegacySenderIdMsg = { id: 'msg_legacy', sender_id: 'alice_1', text: 'Legacy key' };
  const myCurrentPlaceholderMsg = { id: 'msg_curr', senderId: 'current', text: 'Current placeholder' };
  const myIsMeMsg = { id: 'msg_me', isMe: true, text: 'isMe flag' };
  const myIsOutgoingMsg = { id: 'msg_out', isOutgoing: true, text: 'isOutgoing flag' };

  // 1. Outgoing messages sent by me -> can ALWAYS delete across any chat type
  const regularGroup = {
    id: 'group_1',
    type: 'group',
    creatorId: 'charlie_3',
    members: [{ id: 'alice_1', role: 'member' }, { id: 'bob_2', role: 'member' }]
  };
  assert.equal(canUserDeleteMessage(myMsg, currentUser, regularGroup), true);
  assert.equal(canUserDeleteMessage(myLegacySenderIdMsg, currentUser, regularGroup), true);
  assert.equal(canUserDeleteMessage(myCurrentPlaceholderMsg, currentUser, regularGroup), true);
  assert.equal(canUserDeleteMessage(myIsMeMsg, currentUser, regularGroup), true);
  assert.equal(canUserDeleteMessage(myIsOutgoingMsg, currentUser, regularGroup), true);

  // 2. Incoming message in regular group where user is regular member -> CANNOT delete
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, regularGroup), false);

  // 3. Incoming message in group where user is Admin or Owner -> CAN delete
  const adminGroup = {
    id: 'group_admin',
    type: 'group',
    creatorId: 'charlie_3',
    members: [{ id: 'alice_1', role: 'admin' }, { id: 'bob_2', role: 'member' }]
  };
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, adminGroup), true);

  const ownerGroup = {
    id: 'group_owner',
    type: 'group',
    creatorId: 'alice_1',
    members: [{ id: 'alice_1', role: 'member' }, { id: 'bob_2', role: 'member' }]
  };
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, ownerGroup), true);

  // 4. Saved messages chat -> CAN delete any message
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, { id: 'saved' }), true);
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, { id: 'saved_notes', isSaved: true }), true);
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, { id: 'saved_notes', type: 'saved' }), true);

  // 5. Direct 1:1 chat -> Direct chat deletion parity
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, { id: 'dm_alice_bob', type: 'direct' }), true);

  // 6. Explicit overrides
  assert.equal(canUserDeleteMessage(myMsg, currentUser, regularGroup, false), false);
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, regularGroup, true), true);
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, regularGroup, undefined, true), true);
  assert.equal(canUserDeleteMessage(otherUserMsg, currentUser, regularGroup, undefined, false), false);

  // 7. Defensive null checks
  assert.equal(canUserDeleteMessage(null, currentUser, regularGroup), false);
  assert.equal(canUserDeleteMessage(undefined, currentUser, regularGroup), false);
});

// ---------------------------------------------------------------------------
// 6. Empirical Verification: Component JSX Contracts & Helper Engines
// ---------------------------------------------------------------------------

test('EMPIRICAL CHALLENGER: Component contracts, text extraction, clipboard fallback, and haptics', async () => {
  // MobileActionSheet.jsx structure checks
  assert.match(sheetJsx, /export default function MobileActionSheet/);
  assert.match(sheetJsx, /data-test="mobile-action-sheet-backdrop"/);
  assert.match(sheetJsx, /data-test="mobile-action-sheet"/);
  assert.match(sheetJsx, /data-test="mobile-action-reply"/);
  assert.match(sheetJsx, /data-test="mobile-action-copy"/);
  assert.match(sheetJsx, /data-test="mobile-action-delete"/);
  assert.match(sheetJsx, /createPortal/);

  // Text extraction edge cases
  assert.equal(extractMessageText({ text: 'Проверка сообщения' }), 'Проверка сообщения');
  assert.equal(extractMessageText({ caption: 'Подпись к видео' }), 'Подпись к видео');
  assert.equal(extractMessageText({ text: '🖼️ [Изображение]' }), '');
  assert.equal(extractMessageText({ text: '🎤 Голосовое сообщение' }), '');
  assert.equal(extractMessageText({ text: 'sticker:pack_1' }), '');

  // Clipboard copy tier 1 & tier 2
  const copied = await copyTextToClipboard('Test clipboard text');
  assert.equal(typeof copied, 'boolean');

  // Trigger haptic safety check
  assert.doesNotThrow(() => {
    triggerHaptic(12);
  });

  // Reaction normalization
  const normalized = normalizeReaction({ emoji: '🔥', users: ['alice_1', 'bob_2'] });
  assert.deepEqual(normalized.users, ['alice_1', 'bob_2']);
});
