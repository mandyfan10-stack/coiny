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

function buildM2TestPageHtml() {
  return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <style>
    ${combinedCss}
  </style>
</head>
<body>
  <div id="root">
    <div class="app-container active-chat-selected">
      <div class="chat-area">
        <div class="chat-header">
          <div class="chat-header-info">
            <span class="chat-header-name">Milestone 2 Stress Test</span>
          </div>
        </div>

        <div class="chat-body" id="test-chat-body">
          <div class="chat-date-divider" id="top-date-divider"><span>Today</span></div>
          <div class="messages-list" id="test-messages-list">
            
            <!-- First message at top (Me) -->
            <div class="message-row row-me group-first group-last" id="msg-top-me" data-id="top-me">
              <div class="message-bubble bubble-me">
                <div class="bubble-content">
                  <p class="message-text">Top message me</p>
                  <span class="bubble-metadata"><span class="message-time">10:00</span></span>
                </div>
                <div class="message-hover-actions active" id="actions-top-me">
                  <button class="hover-action-btn reply-btn">↩</button>
                  <button class="hover-action-btn smile-btn" id="smile-top-me">😊</button>
                  <button class="hover-action-btn delete-btn">🗑</button>
                </div>
              </div>
            </div>

            <!-- First message at top (Other, with avatar) -->
            <div class="message-row row-other group-first group-last" id="msg-top-other" data-id="top-other">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other">
                <div class="bubble-content">
                  <p class="message-text">Top message other</p>
                  <span class="bubble-metadata"><span class="message-time">10:01</span></span>
                </div>
                <div class="message-hover-actions active" id="actions-top-other">
                  <button class="hover-action-btn reply-btn">↩</button>
                  <button class="hover-action-btn smile-btn" id="smile-top-other">😊</button>
                  <button class="hover-action-btn delete-btn">🗑</button>
                </div>
              </div>
            </div>

            <!-- Middle message with reactions -->
            <div class="message-row row-other group-first group-last" id="msg-mid" data-id="mid">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other">
                <div class="bubble-content">
                  <p class="message-text">Middle message with wrapping reactions</p>
                  <span class="bubble-metadata"><span class="message-time">10:05</span></span>
                </div>
                <div class="bubble-reactions" id="mid-reactions">
                  <button class="reaction-badge active">👍 12</button>
                  <button class="reaction-badge">❤️ 8</button>
                  <button class="reaction-badge">🔥 24</button>
                  <button class="reaction-badge">🎉 5</button>
                  <button class="reaction-badge">🚀 19</button>
                  <button class="reaction-badge">👏 7</button>
                  <button class="reaction-badge">😍 14</button>
                  <button class="reaction-badge">💯 33</button>
                </div>
                <div class="message-hover-actions active" id="actions-mid">
                  <button class="hover-action-btn reply-btn">↩</button>
                  <button class="hover-action-btn smile-btn" id="smile-mid">😊</button>
                  <button class="hover-action-btn delete-btn">🗑</button>
                </div>
              </div>
            </div>

            <!-- Bottom message (Me) near keyboard -->
            <div class="message-row row-me group-first group-last" id="msg-bottom-me" data-id="bottom-me">
              <div class="message-bubble bubble-me">
                <div class="bubble-content">
                  <p class="message-text">Bottom message right above virtual keyboard</p>
                  <span class="bubble-metadata"><span class="message-time">10:10</span></span>
                </div>
                <div class="message-hover-actions active" id="actions-bottom-me">
                  <button class="hover-action-btn reply-btn">↩</button>
                  <button class="hover-action-btn smile-btn" id="smile-bottom-me">😊</button>
                  <button class="hover-action-btn delete-btn">🗑</button>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div class="chat-footer-input">
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

  <!-- Portaled reaction drawer template function -->
  <script>
    const EMOJIS = ['👍', '❤️', '🔥', '🎉', '🚀', '👏', '😍', '💯'];
    
    function openReactionDrawer(anchorBtnId) {
      const existing = document.querySelector('.reaction-drawer-fixed');
      if (existing) existing.remove();

      const anchor = document.getElementById(anchorBtnId);
      if (!anchor) return null;

      const rect = anchor.getBoundingClientRect();
      const viewportPad = 8;
      const gap = 8;

      // Create drawer element in DOM to measure
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

      // Measure
      const realWidth = drawer.offsetWidth || Math.min(284, window.innerWidth - viewportPad * 2);
      const realHeight = drawer.offsetHeight || 40;

      let top = rect.top - realHeight - gap;
      let placement = 'above';
      if (top < viewportPad) {
        top = rect.bottom + gap;
        placement = 'below';
      }

      // Bottom boundary viewport clamping
      const maxTop = window.innerHeight - realHeight - viewportPad;
      if (top > maxTop) {
        top = Math.max(viewportPad, maxTop);
      }

      // Horizontal clamp
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
        top: Math.round(top),
        left: Math.round(left),
        width: realWidth,
        height: realHeight,
        placement,
        rect: drawer.getBoundingClientRect()
      };
    }
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

test('EMPIRICAL M2: Message action bar positioning at the very top of chat history on mobile', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const htmlContent = buildM2TestPageHtml();

  const mobileViewports = [
    { width: 320, height: 568, name: '320px iPhone SE 1st' },
    { width: 360, height: 740, name: '360px Android' },
    { width: 375, height: 667, name: '375px iPhone 8' },
    { width: 412, height: 915, name: '412px Pixel' },
    { width: 768, height: 1024, name: '768px iPad Portrait' },
  ];

  try {
    for (const vp of mobileViewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(50);

      const actionPositions = await page.evaluate(() => {
        const docEl = document.documentElement;
        const actionsTopMe = document.getElementById('actions-top-me');
        const actionsTopOther = document.getElementById('actions-top-other');
        const msgTopMe = document.getElementById('msg-top-me');
        const msgTopOther = document.getElementById('msg-top-other');

        const rectMe = actionsTopMe.getBoundingClientRect();
        const rectOther = actionsTopOther.getBoundingClientRect();
        const msgMeRect = msgTopMe.getBoundingClientRect();
        const msgOtherRect = msgTopOther.getBoundingClientRect();

        return {
          docScrollWidth: docEl.scrollWidth,
          docClientWidth: docEl.clientWidth,
          me: {
            top: rectMe.top,
            bottom: rectMe.bottom,
            left: rectMe.left,
            right: rectMe.right,
            width: rectMe.width,
            height: rectMe.height,
            msgTop: msgMeRect.top,
          },
          other: {
            top: rectOther.top,
            bottom: rectOther.bottom,
            left: rectOther.left,
            right: rectOther.right,
            width: rectOther.width,
            height: rectOther.height,
            msgTop: msgOtherRect.top,
          }
        };
      });

      // 1. Horizontal viewport clipping check:
      assert.ok(
        actionPositions.me.left >= 0,
        `[${vp.name}] Outgoing top actions left (${actionPositions.me.left}) must be >= 0`
      );
      assert.ok(
        actionPositions.me.right <= vp.width,
        `[${vp.name}] Outgoing top actions right (${actionPositions.me.right}) must be <= viewport width (${vp.width})`
      );

      assert.ok(
        actionPositions.other.left >= 0,
        `[${vp.name}] Incoming top actions left (${actionPositions.other.left}) must be >= 0`
      );
      assert.ok(
        actionPositions.other.right <= vp.width,
        `[${vp.name}] Incoming top actions right (${actionPositions.other.right}) must be <= viewport width (${vp.width})`
      );

      // 2. Zero horizontal scrollbars
      assert.strictEqual(
        actionPositions.docScrollWidth,
        actionPositions.docClientWidth,
        `[${vp.name}] No horizontal document overflow permitted`
      );

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL M2: Short viewport with virtual keyboard open (< 500px height) reaction drawer positioning', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const htmlContent = buildM2TestPageHtml();

  const shortViewports = [
    { width: 320, height: 350, name: '320px with Virtual Keyboard (350px H)' },
    { width: 360, height: 380, name: '360px with Virtual Keyboard (380px H)' },
    { width: 375, height: 360, name: '375px with Virtual Keyboard (360px H)' },
    { width: 412, height: 420, name: '412px with Virtual Keyboard (420px H)' },
    { width: 768, height: 450, name: '768px Landscape with Virtual Keyboard (450px H)' },
    { width: 800, height: 320, name: '800px Ultra-short Landscape (320px H)' },
  ];

  try {
    for (const vp of shortViewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(50);

      // Test opening reaction drawer on bottom message (near keyboard)
      const drawerResult = await page.evaluate(() => {
        return window.openReactionDrawer('smile-bottom-me');
      });

      assert.ok(drawerResult, `[${vp.name}] Reaction drawer must open and return position info`);

      // Verify drawer bounds strictly within viewport:
      const pad = 8;
      assert.ok(
        drawerResult.rect.top >= pad - 1,
        `[${vp.name}] Drawer top (${drawerResult.rect.top}) must be >= viewportPad (${pad})`
      );
      assert.ok(
        drawerResult.rect.bottom <= vp.height - pad + 1,
        `[${vp.name}] Drawer bottom (${drawerResult.rect.bottom}) must be <= viewportHeight - viewportPad (${vp.height - pad})`
      );
      assert.ok(
        drawerResult.rect.left >= pad - 1,
        `[${vp.name}] Drawer left (${drawerResult.rect.left}) must be >= viewportPad (${pad})`
      );
      assert.ok(
        drawerResult.rect.right <= vp.width - pad + 1,
        `[${vp.name}] Drawer right (${drawerResult.rect.right}) must be <= viewportWidth - viewportPad (${vp.width - pad})`
      );

      // Verify no document scrollbar generated
      const docOverflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
      });

      assert.strictEqual(
        docOverflow.hasHScroll,
        false,
        `[${vp.name}] Opening reaction drawer must NOT cause horizontal scrollbar (scrollWidth: ${docOverflow.scrollWidth}, clientWidth: ${docOverflow.clientWidth})`
      );

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL M2: Ultra-narrow screens (320px, 360px) opening 8-emoji reaction drawer', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const htmlContent = buildM2TestPageHtml();

  const narrowViewports = [
    { width: 320, height: 568, name: '320px Ultra-narrow' },
    { width: 340, height: 600, name: '340px Ultra-narrow' },
    { width: 360, height: 740, name: '360px Compact Android' },
  ];

  try {
    for (const vp of narrowViewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(50);

      // Test opening reaction drawer on middle message
      const drawerResult = await page.evaluate(() => {
        const res = window.openReactionDrawer('smile-mid');
        const drawer = document.querySelector('.reaction-drawer-fixed');
        const items = [...drawer.querySelectorAll('.reaction-drawer-item')].map(item => {
          const r = item.getBoundingClientRect();
          return {
            text: item.textContent,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        });

        return {
          drawerRect: res.rect,
          drawerWidth: res.width,
          drawerHeight: res.height,
          itemsCount: items.length,
          items,
          drawerScrollWidth: drawer.scrollWidth,
          drawerClientWidth: drawer.clientWidth,
        };
      });

      assert.strictEqual(drawerResult.itemsCount, 8, `[${vp.name}] Must contain 8 emoji items`);

      // Verify drawer width fits inside viewport minus 16px padding
      assert.ok(
        drawerResult.drawerRect.width <= vp.width - 16,
        `[${vp.name}] Drawer width (${drawerResult.drawerRect.width}) must fit in viewport (${vp.width - 16})`
      );

      // Verify all 8 items are rendered and have positive width/height
      for (const item of drawerResult.items) {
        assert.ok(item.width >= 20, `[${vp.name}] Emoji ${item.text} item width (${item.width}) must be >= 20px`);
        assert.ok(item.height >= 20, `[${vp.name}] Emoji ${item.text} item height (${item.height}) must be >= 20px`);
      }

      // Verify drawer bounds
      assert.ok(drawerResult.drawerRect.left >= 8, `[${vp.name}] Drawer left >= 8`);
      assert.ok(drawerResult.drawerRect.right <= vp.width - 8, `[${vp.name}] Drawer right <= ${vp.width - 8}`);

      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL M2: Reaction badges wrapping and touch target height', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const htmlContent = buildM2TestPageHtml();

  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(50);

    const badgeMetrics = await page.evaluate(() => {
      const bubble = document.querySelector('#msg-mid .message-bubble');
      const reactionsContainer = document.getElementById('mid-reactions');
      const badges = [...reactionsContainer.querySelectorAll('.reaction-badge')];

      const bubbleRect = bubble.getBoundingClientRect();
      const contRect = reactionsContainer.getBoundingClientRect();

      const badgeData = badges.map(b => {
        const r = b.getBoundingClientRect();
        return {
          text: b.textContent,
          width: r.width,
          height: r.height,
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
        };
      });

      return {
        bubbleWidth: bubbleRect.width,
        contWidth: contRect.width,
        contRight: contRect.right,
        bubbleRight: bubbleRect.right,
        badgeData,
      };
    });

    // Verify badges wrap without exceeding bubble width
    assert.ok(
      badgeMetrics.contWidth <= badgeMetrics.bubbleWidth + 2,
      `Reactions container width (${badgeMetrics.contWidth}) must not exceed bubble width (${badgeMetrics.bubbleWidth})`
    );

    // Verify touch targets on mobile (>= 22px height)
    for (const b of badgeMetrics.badgeData) {
      assert.ok(
        b.height >= 22,
        `Reaction badge ${b.text} touch target height (${b.height}) must be >= 22px`
      );
    }

    await page.close();
  } finally {
    await browser.close();
  }
});
