import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const indexCss = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const chatAreaCss = fs.readFileSync(new URL('../src/components/ChatArea.css', import.meta.url), 'utf8');
const chatInfoCss = fs.readFileSync(new URL('../src/components/ChatInfo.css', import.meta.url), 'utf8');

const combinedCss = `
${indexCss}
${chatAreaCss}
${chatInfoCss}
`;

function buildAdversarialHarnessHtml() {
  return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <style>
    ${combinedCss}
    /* Specific harness positioning containers for precise pixel-coordinate stress testing */
    .test-harness-wrapper {
      position: absolute;
      inset: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="app-container active-chat-selected">
      <div class="chat-area">
        <div class="chat-header" id="chat-header">
          <div class="chat-header-info">
            <span class="chat-header-name">Adversarial Stress Harness</span>
          </div>
        </div>

        <div class="chat-body" id="harness-chat-body" style="height: 100%; position: relative;">
          
          <!-- Container for dynamically placed test elements -->
          <div id="dynamic-test-container"></div>

        </div>

        <div class="chat-footer-input" id="chat-footer">
          <div class="input-row">
            <div class="input-textarea-wrapper">
              <textarea placeholder="Сообщение..."></textarea>
            </div>
            <button class="send-message-btn">➤</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const EMOJIS = ['👍', '❤️', '🔥', '🎉', '🚀', '👏', '😍', '💯'];

    function createTestMessage({
      id,
      type = 'me', // 'me' or 'other'
      isFirstChild = false,
      text = 'Test message content',
      mediaType = null, // 'photo', 'video', 'voice', 'sticker'
      reactionCount = 0,
      customStyle = ''
    }) {
      const container = document.getElementById('dynamic-test-container');
      const row = document.createElement('div');
      row.id = id;
      row.className = 'message-row ' + (type === 'me' ? 'row-me' : 'row-other') + ' group-first group-last' + (isFirstChild ? ' first-child-in-chat' : '');
      if (customStyle) {
        row.style.cssText = customStyle;
      }

      let avatarHtml = '';
      if (type === 'other') {
        avatarHtml = '<div class="message-avatar-col"><div class="message-sender-avatar">👤</div></div>';
      }

      let contentHtml = '';
      let bubbleExtraClass = '';

      if (mediaType === 'photo') {
        bubbleExtraClass = ' bubble-media-only';
        contentHtml = \`
          <div class="bubble-media-wrapper">
            <button type="button" class="bubble-media-open">
              <div class="bubble-media" style="width: 220px; height: 140px; background: #34495e; border-radius: inherit;"></div>
            </button>
            <span class="bubble-metadata floating-badge"><span class="message-time">10:00</span></span>
          </div>
        \`;
      } else if (mediaType === 'video') {
        bubbleExtraClass = ' bubble-media-only';
        contentHtml = \`
          <div class="bubble-media-wrapper">
            <div class="regular-video-wrapper" style="width: 220px; height: 140px; background: #000;">
              <video style="width: 100%; height: 100%; object-fit: cover;"></video>
            </div>
            <span class="bubble-metadata floating-badge"><span class="message-time">10:00</span></span>
          </div>
        \`;
      } else if (mediaType === 'voice') {
        contentHtml = \`
          <div class="bubble-content">
            <div style="display: flex; align-items: center;">
              <div class="voice-player-bubble">
                <button class="voice-play-btn" style="width:30px;height:30px;">▶</button>
                <div class="voice-player-details">
                  <div class="voice-player-meta">0:15 / 1:00</div>
                </div>
              </div>
              <span class="bubble-metadata"><span class="message-time">10:00</span></span>
            </div>
          </div>
        \`;
      } else {
        contentHtml = \`
          <div class="bubble-content">
            <p class="message-text">\${text}</p>
            <span class="bubble-metadata"><span class="message-time">10:00</span></span>
          </div>
        \`;
      }

      let reactionsHtml = '';
      if (reactionCount > 0) {
        const badges = EMOJIS.slice(0, reactionCount).map((emo, i) => \`
          <button class="reaction-badge \${i === 0 ? 'active' : ''}">\${emo} <span class="react-count">\${(i + 1) * 3}</span></button>
        \`).join('');
        reactionsHtml = \`<div class="bubble-reactions" id="\${id}-reactions">\${badges}</div>\`;
      }

      const actionsHtml = \`
        <div class="message-hover-actions active" id="\${id}-actions">
          <button class="hover-action-btn reply-btn">↩</button>
          <button class="hover-action-btn smile-btn" id="\${id}-smile">😊</button>
          <button class="hover-action-btn delete-btn">🗑</button>
        </div>
      \`;

      row.innerHTML = \`
        \${avatarHtml}
        <div class="message-bubble \${type === 'me' ? 'bubble-me' : 'bubble-other'}\${bubbleExtraClass}">
          \${contentHtml}
          \${reactionsHtml}
          \${actionsHtml}
        </div>
      \`;

      container.appendChild(row);
      return row;
    }

    function openReactionDrawerForAnchor(anchorId) {
      const existing = document.querySelector('.reaction-drawer-fixed');
      if (existing) existing.remove();

      const anchor = document.getElementById(anchorId);
      if (!anchor) return null;

      const rect = anchor.getBoundingClientRect();
      const viewportPad = 8;
      const gap = 8;

      const drawer = document.createElement('div');
      drawer.className = 'reaction-drawer reaction-drawer-fixed';
      drawer.setAttribute('role', 'listbox');
      drawer.setAttribute('aria-label', 'Реакции');
      
      EMOJIS.forEach(emo => {
        const item = document.createElement('span');
        item.className = 'reaction-drawer-item';
        item.setAttribute('role', 'option');
        item.textContent = emo;
        drawer.appendChild(item);
      });

      drawer.style.position = 'fixed';
      drawer.style.visibility = 'hidden';
      document.body.appendChild(drawer);

      const realWidth = drawer.offsetWidth || Math.min(284, window.innerWidth - viewportPad * 2);
      const realHeight = drawer.offsetHeight || 40;

      let top = rect.top - realHeight - gap;
      let placement = 'above';
      if (top < viewportPad) {
        top = rect.bottom + gap;
        placement = 'below';
      }
      top = Math.max(viewportPad, top);

      const maxTop = window.innerHeight - realHeight - viewportPad;
      if (top > maxTop) {
        top = Math.max(viewportPad, maxTop);
      }

      let left = rect.left + rect.width / 2 - realWidth / 2;
      const maxLeft = window.innerWidth - realWidth - viewportPad;
      left = Math.max(viewportPad, Math.min(left, maxLeft));

      drawer.style.top = Math.round(top) + 'px';
      drawer.style.left = Math.round(left) + 'px';
      drawer.style.zIndex = '10050';
      drawer.style.visibility = 'visible';
      drawer.style.setProperty('--reaction-placement', placement);
      if (placement === 'below') {
        drawer.classList.add('reaction-drawer-below');
      }

      return {
        anchorRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        top: Math.round(top),
        left: Math.round(left),
        width: realWidth,
        height: realHeight,
        placement,
        rect: drawer.getBoundingClientRect()
      };
    }

    function clearTestContainer() {
      const container = document.getElementById('dynamic-test-container');
      if (container) container.innerHTML = '';
      const existingDrawer = document.querySelector('.reaction-drawer-fixed');
      if (existingDrawer) existingDrawer.remove();
      const existingAnchors = document.querySelectorAll('#stress-anchor');
      existingAnchors.forEach(a => a.remove());
    }
  </script>
</body>
</html>
  `;
}

const VIEWPORT_MATRIX = [
  { width: 320, height: 568, label: '320px (iPhone SE 1st Gen)' },
  { width: 360, height: 740, label: '360px (Standard Compact Android)' },
  { width: 375, height: 667, label: '375px (iPhone 8 / SE 2nd Gen)' },
  { width: 412, height: 915, label: '412px (Modern Pixel/Galaxy)' },
  { width: 768, height: 1024, label: '768px (Tablet Breakpoint)' }
];

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

test('EMPIRICAL ADVERSARIAL: Action buttons & reaction drawer at very top of chat (y = 0..30px)', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const html = buildAdversarialHarnessHtml();

  try {
    for (const vp of VIEWPORT_MATRIX) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

      for (const yPos of [0, 10, 20, 30]) {
        for (const type of ['me', 'other']) {
          const testId = `top-${type}-y${yPos}`;

          await page.evaluate(({ testId, type, yPos }) => {
            window.clearTestContainer();
            window.createTestMessage({
              id: testId,
              type,
              text: `Message at top y=${yPos}px`,
              customStyle: `position: absolute; top: ${yPos}px; left: 0; right: 0; margin: 0;`
            });
          }, { testId, type, yPos });

          await page.waitForTimeout(30);

          // Evaluate action buttons bounds & horizontal scroll
          const actionEvaluation = await page.evaluate(({ testId }) => {
            const actions = document.getElementById(`${testId}-actions`);
            const rect = actions.getBoundingClientRect();
            const doc = document.documentElement;
            const body = document.body;
            const chatBody = document.getElementById('harness-chat-body');

            return {
              rect: {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height
              },
              docScrollWidth: doc.scrollWidth,
              docClientWidth: doc.clientWidth,
              bodyScrollWidth: body.scrollWidth,
              bodyClientWidth: body.clientWidth,
              chatBodyScrollWidth: chatBody.scrollWidth,
              chatBodyClientWidth: chatBody.clientWidth,
            };
          }, { testId });

          // 1. Action buttons horizontal viewport bounds:
          assert.ok(
            actionEvaluation.rect.left >= 0,
            `[${vp.label}, y=${yPos}, ${type}] Action buttons left (${actionEvaluation.rect.left}) must be >= 0`
          );
          assert.ok(
            actionEvaluation.rect.right <= vp.width,
            `[${vp.label}, y=${yPos}, ${type}] Action buttons right (${actionEvaluation.rect.right}) must be <= viewport width (${vp.width})`
          );

          // 2. Zero horizontal overflow:
          assert.strictEqual(
            actionEvaluation.docScrollWidth,
            actionEvaluation.docClientWidth,
            `[${vp.label}, y=${yPos}, ${type}] Document must have zero horizontal overflow`
          );
          assert.strictEqual(
            actionEvaluation.bodyScrollWidth,
            actionEvaluation.bodyClientWidth,
            `[${vp.label}, y=${yPos}, ${type}] Body must have zero horizontal overflow`
          );
          assert.strictEqual(
            actionEvaluation.chatBodyScrollWidth,
            actionEvaluation.chatBodyClientWidth,
            `[${vp.label}, y=${yPos}, ${type}] ChatBody must have zero horizontal overflow`
          );

          // 3. Open reaction drawer and verify positioning & collision handling:
          const drawerResult = await page.evaluate(({ testId }) => {
            return window.openReactionDrawerForAnchor(`${testId}-smile`);
          }, { testId });

          // Verify drawer is strictly within viewport bounds:
          const pad = 8;
          assert.ok(
            drawerResult.rect.top >= pad - 1,
            `[${vp.label}, y=${yPos}, ${type}] Drawer top (${drawerResult.rect.top}) must be >= ${pad}`
          );
          assert.ok(
            drawerResult.rect.bottom <= vp.height - pad + 1,
            `[${vp.label}, y=${yPos}, ${type}] Drawer bottom (${drawerResult.rect.bottom}) must be <= ${vp.height - pad}`
          );
          assert.ok(
            drawerResult.rect.left >= pad - 1,
            `[${vp.label}, y=${yPos}, ${type}] Drawer left (${drawerResult.rect.left}) >= ${pad}`
          );
          assert.ok(
            drawerResult.rect.right <= vp.width - pad + 1,
            `[${vp.label}, y=${yPos}, ${type}] Drawer right (${drawerResult.rect.right}) <= ${vp.width - pad}`
          );

          // If top < pad + realHeight + gap, verify placement decision
          if (drawerResult.anchorRect.top < pad + drawerResult.height + 8) {
            assert.strictEqual(
              drawerResult.placement,
              'below',
              `[${vp.label}, y=${yPos}, ${type}] When anchor is near top edge, drawer must flip 'below'`
            );
          } else {
            assert.strictEqual(
              drawerResult.placement,
              'above',
              `[${vp.label}, y=${yPos}, ${type}] When sufficient space above anchor, drawer places 'above'`
            );
          }
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL ADVERSARIAL: Action buttons & reaction drawer at very bottom of chat (y = innerHeight - 60px)', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const html = buildAdversarialHarnessHtml();

  try {
    for (const vp of VIEWPORT_MATRIX) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

      for (const bottomOffset of [60, 45, 30]) {
        for (const type of ['me', 'other']) {
          const testId = `bottom-${type}-off${bottomOffset}`;

          await page.evaluate(({ testId, type, bottomOffset }) => {
            window.clearTestContainer();
            window.createTestMessage({
              id: testId,
              type,
              text: `Message near bottom offset ${bottomOffset}px`,
              customStyle: `position: absolute; bottom: ${bottomOffset}px; left: 0; right: 0; margin: 0;`
            });
          }, { testId, type, bottomOffset });

          await page.waitForTimeout(30);

          const actionEvaluation = await page.evaluate(({ testId }) => {
            const actions = document.getElementById(`${testId}-actions`);
            const rect = actions.getBoundingClientRect();
            const doc = document.documentElement;

            return {
              rect: {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height
              },
              docScrollWidth: doc.scrollWidth,
              docClientWidth: doc.clientWidth
            };
          }, { testId });

          // 1. Horizontal bounds check
          assert.ok(
            actionEvaluation.rect.left >= 0,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Actions left (${actionEvaluation.rect.left}) >= 0`
          );
          assert.ok(
            actionEvaluation.rect.right <= vp.width,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Actions right (${actionEvaluation.rect.right}) <= ${vp.width}`
          );

          // 2. Open reaction drawer
          const drawerResult = await page.evaluate(({ testId }) => {
            return window.openReactionDrawerForAnchor(`${testId}-smile`);
          }, { testId });

          assert.ok(drawerResult, `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Drawer must open`);

          // Verify drawer is placed 'above' and clamped properly
          assert.strictEqual(
            drawerResult.placement,
            'above',
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Drawer near bottom must place 'above' anchor`
          );

          const pad = 8;
          assert.ok(
            drawerResult.rect.top >= pad - 1,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Drawer top (${drawerResult.rect.top}) >= ${pad}`
          );
          assert.ok(
            drawerResult.rect.bottom <= vp.height - pad + 1,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Drawer bottom (${drawerResult.rect.bottom}) <= ${vp.height - pad}`
          );
          assert.ok(
            drawerResult.rect.left >= pad - 1,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Drawer left (${drawerResult.rect.left}) >= ${pad}`
          );
          assert.ok(
            drawerResult.rect.right <= vp.width - pad + 1,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Drawer right (${drawerResult.rect.right}) <= ${vp.width - pad}`
          );

          // 3. Document horizontal overflow
          const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
          assert.strictEqual(
            docOverflow,
            false,
            `[${vp.label}, bottomOffset=${bottomOffset}, ${type}] Must not cause horizontal scrollbar`
          );
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL ADVERSARIAL: Extreme horizontal edge positions (leftmost incoming, rightmost outgoing, wide and narrow bubbles)', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const html = buildAdversarialHarnessHtml();

  try {
    for (const vp of VIEWPORT_MATRIX) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Test cases:
      // 1. Ultra-short bubble (e.g. "K")
      // 2. Ultra-long wide bubble
      // 3. Pure photo with 8 reactions
      // 4. Captioned video with 8 reactions
      // 5. Voice message with reactions
      const testCases = [
        { id: 'short-me', type: 'me', text: 'K', mediaType: null, reactionCount: 0 },
        { id: 'short-other', type: 'other', text: 'K', mediaType: null, reactionCount: 0 },
        { id: 'wide-me', type: 'me', text: 'Super wide paragraph with substantial text length demonstrating responsive width containment', mediaType: null, reactionCount: 8 },
        { id: 'wide-other', type: 'other', text: 'Super wide incoming group message demonstrating responsive max-width calc(100% - 44px)', mediaType: null, reactionCount: 8 },
        { id: 'photo-other', type: 'other', text: '', mediaType: 'photo', reactionCount: 8 },
        { id: 'video-me', type: 'me', text: '', mediaType: 'video', reactionCount: 8 },
        { id: 'voice-other', type: 'other', text: '', mediaType: 'voice', reactionCount: 5 },
      ];

      for (const tc of testCases) {
        await page.evaluate((tc) => {
          window.clearTestContainer();
          window.createTestMessage({
            id: tc.id,
            type: tc.type,
            text: tc.text,
            mediaType: tc.mediaType,
            reactionCount: tc.reactionCount,
            customStyle: 'position: relative; margin: 20px 0;'
          });
        }, tc);

        await page.waitForTimeout(30);

        const evaluation = await page.evaluate((tc) => {
          const row = document.getElementById(tc.id);
          const bubble = row.querySelector('.message-bubble');
          const actions = document.getElementById(`${tc.id}-actions`);
          const reactions = row.querySelector('.bubble-reactions');

          const bubbleRect = bubble.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const reactionsRect = reactions ? reactions.getBoundingClientRect() : null;

          const doc = document.documentElement;

          return {
            bubbleRect,
            actionsRect,
            reactionsRect,
            docScrollWidth: doc.scrollWidth,
            docClientWidth: doc.clientWidth,
          };
        }, tc);

        // 1. Actions bounding box:
        assert.ok(
          evaluation.actionsRect.left >= 0,
          `[${vp.label}, ${tc.id}] Actions left (${evaluation.actionsRect.left}) >= 0`
        );
        assert.ok(
          evaluation.actionsRect.right <= vp.width,
          `[${vp.label}, ${tc.id}] Actions right (${evaluation.actionsRect.right}) <= ${vp.width}`
        );

        // 2. Bubble bounding box:
        assert.ok(
          evaluation.bubbleRect.left >= 0,
          `[${vp.label}, ${tc.id}] Bubble left (${evaluation.bubbleRect.left}) >= 0`
        );
        assert.ok(
          evaluation.bubbleRect.right <= vp.width,
          `[${vp.label}, ${tc.id}] Bubble right (${evaluation.bubbleRect.right}) <= ${vp.width}`
        );

        // 3. Reactions containment:
        if (evaluation.reactionsRect) {
          assert.ok(
            evaluation.reactionsRect.left >= evaluation.bubbleRect.left - 1,
            `[${vp.label}, ${tc.id}] Reactions left >= bubble left`
          );
          assert.ok(
            evaluation.reactionsRect.right <= evaluation.bubbleRect.right + 1,
            `[${vp.label}, ${tc.id}] Reactions right <= bubble right`
          );
        }

        // 4. Zero horizontal scrollbar:
        assert.strictEqual(
          evaluation.docScrollWidth,
          evaluation.docClientWidth,
          `[${vp.label}, ${tc.id}] Document horizontal overflow must be 0`
        );

        // 5. Open reaction drawer and verify horizontal and vertical clamping:
        const drawerResult = await page.evaluate((tc) => {
          return window.openReactionDrawerForAnchor(`${tc.id}-smile`);
        }, tc);

        assert.ok(drawerResult, `[${vp.label}, ${tc.id}] Drawer opened`);

        const pad = 8;
        assert.ok(
          drawerResult.rect.left >= pad - 1,
          `[${vp.label}, ${tc.id}] Drawer left (${drawerResult.rect.left}) >= ${pad}`
        );
        assert.ok(
          drawerResult.rect.right <= vp.width - pad + 1,
          `[${vp.label}, ${tc.id}] Drawer right (${drawerResult.rect.right}) <= ${vp.width - pad}`
        );
        assert.ok(
          drawerResult.rect.top >= 0,
          `[${vp.label}, ${tc.id}] Drawer top (${drawerResult.rect.top}) >= 0`
        );
        assert.ok(
          drawerResult.rect.bottom <= vp.height - pad + 1,
          `[${vp.label}, ${tc.id}] Drawer bottom (${drawerResult.rect.bottom}) <= ${vp.height - pad}`
        );

        // 6. Check items inside drawer
        const itemMetrics = await page.evaluate(() => {
          const items = [...document.querySelectorAll('.reaction-drawer-item')];
          return items.map(it => {
            const r = it.getBoundingClientRect();
            return { width: r.width, height: r.height };
          });
        });

        assert.strictEqual(itemMetrics.length, 8, `[${vp.label}, ${tc.id}] Must have 8 reaction items`);
        for (const it of itemMetrics) {
          assert.ok(it.width >= 20, `[${vp.label}, ${tc.id}] Item width (${it.width}) >= 20px`);
          assert.ok(it.height >= 20, `[${vp.label}, ${tc.id}] Item height (${it.height}) >= 20px`);
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL ADVERSARIAL: Exact pixel coordinate stress testing (scrolled top y=0..30px, scrolled bottom y=innerHeight-60px)', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const html = buildAdversarialHarnessHtml();

  try {
    for (const vp of VIEWPORT_MATRIX) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Test extreme fixed anchor coordinates:
      // (1) Anchor at top of window: y=5, y=15, y=25, y=35
      // (2) Anchor at bottom of window: y=vp.height - 60, vp.height - 40, vp.height - 20
      // (3) Anchor at extreme left (x=0, 5, 10) and right (x=vp.width - 25, vp.width - 10)
      const anchorScenarios = [
        { name: 'scrolled-top-y5', top: 5, left: 10, expectedPlacement: 'below' },
        { name: 'scrolled-top-y15', top: 15, left: 50, expectedPlacement: 'below' },
        { name: 'scrolled-top-y25', top: 25, left: 100, expectedPlacement: 'below' },
        { name: 'scrolled-top-y35', top: 35, left: 150, expectedPlacement: 'below' },
        { name: 'scrolled-bottom-60', top: vp.height - 60, left: 100, expectedPlacement: 'above' },
        { name: 'scrolled-bottom-40', top: vp.height - 40, left: 150, expectedPlacement: 'above' },
        { name: 'scrolled-bottom-20', top: vp.height - 20, left: 50, expectedPlacement: 'above' },
        { name: 'extreme-left-edge', top: 200, left: 0, expectedPlacement: 'above' },
        { name: 'extreme-right-edge', top: 200, left: vp.width - 25, expectedPlacement: 'above' },
      ];

      for (const scenario of anchorScenarios) {
        await page.evaluate((s) => {
          window.clearTestContainer();
          const anchor = document.createElement('button');
          anchor.id = 'stress-anchor';
          anchor.className = 'hover-action-btn smile-btn';
          anchor.textContent = '😊';
          anchor.style.cssText = `position: fixed; top: ${s.top}px; left: ${s.left}px; width: 24px; height: 24px; z-index: 9999;`;
          document.body.appendChild(anchor);
        }, scenario);

        await page.waitForTimeout(20);

        const drawerResult = await page.evaluate(() => {
          return window.openReactionDrawerForAnchor('stress-anchor');
        });

        assert.ok(drawerResult, `[${vp.label}, ${scenario.name}] Drawer must open`);

        if (drawerResult.placement !== scenario.expectedPlacement) {
          console.log(`Diagnostic for [${vp.label}, ${scenario.name}]:`, drawerResult);
        }

        // Check placement direction
        assert.strictEqual(
          drawerResult.placement,
          scenario.expectedPlacement,
          `[${vp.label}, ${scenario.name}] Drawer placement must match expected (${scenario.expectedPlacement})`
        );

        // Check bounds
        const pad = 8;
        assert.ok(
          drawerResult.rect.left >= pad - 1,
          `[${vp.label}, ${scenario.name}] Drawer left (${drawerResult.rect.left}) must be >= ${pad}`
        );
        assert.ok(
          drawerResult.rect.right <= vp.width - pad + 1,
          `[${vp.label}, ${scenario.name}] Drawer right (${drawerResult.rect.right}) must be <= ${vp.width - pad}`
        );
        assert.ok(
          drawerResult.rect.top >= pad - 1,
          `[${vp.label}, ${scenario.name}] Drawer top (${drawerResult.rect.top}) must be >= ${pad}`
        );
        assert.ok(
          drawerResult.rect.bottom <= vp.height - pad + 1,
          `[${vp.label}, ${scenario.name}] Drawer bottom (${drawerResult.rect.bottom}) <= ${vp.height - pad}`
        );

        // Check horizontal overflow
        const docOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        assert.strictEqual(docOverflow, false, `[${vp.label}, ${scenario.name}] No horizontal scrollbar`);
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

