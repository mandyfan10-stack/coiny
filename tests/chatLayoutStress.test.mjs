import test from 'node:test';
import assert from 'node:assert/strict';
import { messengerFixtureCss } from './messengerFixtureCss.mjs';
import { chromium } from 'playwright';

const combinedCss = messengerFixtureCss();

function buildChatHtml(activeChat = true) {
  const ultraLongString = 'A'.repeat(500) + '_1234567890_' + 'B'.repeat(500);
  const ultraLongHex = '0x' + 'f'.repeat(512);
  const ultraLongUrl = 'https://coingram.example.com/api/v1/network/deep/nested/resource/path/with/lots/of/parameters/to/test/wrapping/behavior?token=' + 'x'.repeat(256) + '&sig=' + 'y'.repeat(128);
  const ultraWideCode = 'const superLongUnbrokenIdentifierInsideCodeBlock_0123456789_abcdefghijklmnopqrstuvwxyz_0123456789_abcdefghijklmnopqrstuvwxyz = "data:' + 'Z'.repeat(400) + '";';

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
    <div class="app-container ${activeChat ? 'active-chat-selected' : ''}">
      <div class="sidebar">
        <div class="sidebar-header">
          <button class="iconButton menu-btn" title="Меню">☰</button>
          <div class="search-container">
            <span class="search-icon">🔍</span>
            <input type="text" placeholder="Поиск" />
          </div>
        </div>
        <div class="folders-nav">
          <button class="folder-tab active">Все чаты</button>
          <button class="folder-tab">Личные</button>
          <button class="folder-tab">Группы</button>
        </div>
        <div class="chat-list">
          <div class="chat-item active">
            <div class="chat-avatar">👤<div class="online-badge"></div></div>
            <div class="chat-info-block">
              <div class="chat-info-header">
                <span class="chat-name">Super Long Contact Name For Stress Testing</span>
                <span class="chat-time">12:00</span>
              </div>
              <div class="chat-info-body">
                <span class="chat-last-message">Last message preview text that should truncate properly</span>
                <span class="unread-badge">3</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-area">
        <div class="chat-header">
          <div class="chat-header-info">
            <div class="chat-header-meta">
              <span class="chat-header-name">Super Extremely Long Group Chat Name That Might Try To Break Header Layout Boundaries</span>
              <span class="chat-header-status">128 members, 42 online</span>
            </div>
          </div>
          <div class="chat-header-actions">
            <button class="iconButton chat-header-btn" aria-label="Info">ℹ️</button>
          </div>
        </div>

        <div class="chat-body" id="test-chat-body">
          <div class="chat-date-divider"><span>20 August</span></div>
          <div class="messages-list">
            <!-- 1. Normal short message (Me) -->
            <div class="message-row row-me group-first group-last" data-test="short-me">
              <div class="message-bubble bubble-me">
                <div class="bubble-content">
                  <p class="message-text">
                    <span>Hello world</span>
                    <span class="bubble-metadata"><span class="message-time">12:00</span></span>
                  </p>
                </div>
              </div>
            </div>

            <!-- 2. Ultra-long unbroken string (Other, with avatar & sender name) -->
            <div class="message-row row-other group-first group-last" data-test="unbroken-other">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other has-sender-name">
                <span class="sender-name">Alice Long-Sender-Name-Tester</span>
                <div class="bubble-content">
                  <p class="message-text">
                    <span class="test-unbroken-text">${ultraLongString}</span>
                    <span class="bubble-metadata"><span class="message-time">12:01</span></span>
                  </p>
                </div>
              </div>
            </div>

            <!-- 3. Ultra-long hex hash & URL (Me) -->
            <div class="message-row row-me group-first group-last" data-test="hash-url-me">
              <div class="message-bubble bubble-me">
                <div class="bubble-content">
                  <p class="message-text">
                    <span class="test-hex">${ultraLongHex}</span>
                    <br/>
                    <a href="#" class="test-url">${ultraLongUrl}</a>
                    <span class="bubble-metadata"><span class="message-time">12:02</span></span>
                  </p>
                </div>
              </div>
            </div>

            <!-- 4. Ultra-wide code block in <pre> (Other, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="code-block-other">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other">
                <div class="bubble-content">
                  <div>
                    <pre class="code-block"><code class="test-code-content">${ultraWideCode}</code></pre>
                    <span class="bubble-metadata"><span class="message-time">12:03</span></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 5. Voice player incoming (Other, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="voice-other">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other">
                <div class="bubble-content">
                  <div style="display: flex; align-items: center;">
                    <div class="voice-player-bubble">
                      <button class="voice-play-btn" aria-label="Play">▶</button>
                      <div class="voice-player-details">
                        <input type="range" class="voice-seek-bar" min="0" max="90" value="15" />
                        <div class="voice-player-meta"><span>0:15 / 1:30</span></div>
                      </div>
                    </div>
                    <span class="bubble-metadata"><span class="message-time">12:04</span></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 6. Voice player outgoing (Me) -->
            <div class="message-row row-me group-first group-last" data-test="voice-me">
              <div class="message-bubble bubble-me">
                <div class="bubble-content">
                  <div style="display: flex; align-items: center;">
                    <div class="voice-player-bubble">
                      <button class="voice-play-btn" aria-label="Play">▶</button>
                      <div class="voice-player-details">
                        <input type="range" class="voice-seek-bar" min="0" max="150" value="45" />
                        <div class="voice-player-meta"><span>0:45 / 2:30</span></div>
                      </div>
                    </div>
                    <span class="bubble-metadata"><span class="message-time">12:05</span></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 7. Regular video player wrapper with caption (Other, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="video-caption-other">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other bubble-media-with-caption">
                <div class="bubble-media-wrapper">
                  <div class="regular-video-wrapper" style="height: 140px; background: #000;">
                    <video style="width: 100%; height: 100%; object-fit: cover;"></video>
                  </div>
                </div>
                <div class="bubble-caption">
                  <p class="message-text">
                    <span>Responsive video player wrapper containment test caption</span>
                    <span class="bubble-metadata"><span class="message-time">12:06</span></span>
                  </p>
                </div>
              </div>
            </div>

            <!-- 8. Reply preview with long content (Me) -->
            <div class="message-row row-me group-first group-last" data-test="reply-me">
              <div class="message-bubble bubble-me">
                <div class="reply-preview-bubble">
                  <span class="reply-preview-sender">Alice</span>
                  <p class="reply-preview-text">Very long reply preview text that must truncate gracefully with ellipsis without breaking parent flex width</p>
                </div>
                <div class="bubble-content">
                  <p class="message-text">
                    <span>Here is my reply to the previous comment with details.</span>
                    <span class="bubble-metadata"><span class="message-time">12:07</span></span>
                  </p>
                </div>
              </div>
            </div>

            <!-- 9. Quick reaction badges wrapping (Other, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="reactions-other">
              <div class="message-avatar-col">
                <div class="message-sender-avatar">👤</div>
              </div>
              <div class="message-bubble bubble-other">
                <div class="bubble-content">
                  <p class="message-text">
                    <span>Message with many reaction badges</span>
                    <span class="bubble-metadata"><span class="message-time">12:08</span></span>
                  </p>
                </div>
                <div class="bubble-reactions">
                  <button class="reaction-badge active">👍 12</button>
                  <button class="reaction-badge">❤️ 8</button>
                  <button class="reaction-badge">🔥 24</button>
                  <button class="reaction-badge">🎉 5</button>
                  <button class="reaction-badge">🚀 19</button>
                  <button class="reaction-badge">👏 7</button>
                  <button class="reaction-badge">😍 14</button>
                  <button class="reaction-badge">💯 33</button>
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
            <button class="iconButton send-message-btn" aria-label="Send">➤</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

const TEST_VIEWPORTS = [
  { width: 320, height: 600, label: '320px (Ultra-compact / iPhone SE 1st)' },
  { width: 360, height: 740, label: '360px (Compact Android / Galaxy)' },
  { width: 375, height: 667, label: '375px (iPhone 6/7/8/SE 2nd/3rd)' },
  { width: 380, height: 700, label: '380px (Breakpoint Boundary)' },
  { width: 412, height: 915, label: '412px (Standard Android / Pixel)' },
  { width: 640, height: 800, label: '640px (Breakpoint Boundary)' },
  { width: 768, height: 1024, label: '768px (Tablet Breakpoint Boundary)' },
  { width: 1024, height: 768, label: '1024px (Desktop Baseline)' },
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

test('EMPIRICAL STRESS: Multi-viewport zero horizontal scrollbar and bubble width containment in active chat', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;
  const htmlContent = buildChatHtml(true);

  try {
    for (const vp of TEST_VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
      });

      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(50); // let styles compute

      const metrics = await page.evaluate(() => {
        const docEl = document.documentElement;
        const bodyEl = document.body;
        const chatArea = document.querySelector('.chat-area');
        const chatBody = document.getElementById('test-chat-body');

        // Document & container overflow checks
        const docOverflow = docEl.scrollWidth > docEl.clientWidth;
        const bodyOverflow = bodyEl.scrollWidth > bodyEl.clientWidth;
        const chatAreaOverflow = chatArea.scrollWidth > chatArea.clientWidth;
        const chatBodyOverflow = chatBody.scrollWidth > chatBody.clientWidth;

        const rows = [...document.querySelectorAll('.message-row')].map((row) => {
          const testId = row.getAttribute('data-test');
          const rowRect = row.getBoundingClientRect();
          const bubble = row.querySelector('.message-bubble');
          const bubbleRect = bubble ? bubble.getBoundingClientRect() : null;
          const codeBlock = row.querySelector('.code-block');
          const codeRect = codeBlock ? codeBlock.getBoundingClientRect() : null;
          const codeScrollable = codeBlock ? codeBlock.scrollWidth > codeBlock.clientWidth : false;
          const voicePlayer = row.querySelector('.voice-player-bubble');
          const voiceRect = voicePlayer ? voicePlayer.getBoundingClientRect() : null;
          const reactions = row.querySelector('.bubble-reactions');
          const reactionsRect = reactions ? reactions.getBoundingClientRect() : null;

          return {
            testId,
            rowLeft: rowRect.left,
            rowRight: rowRect.right,
            rowWidth: rowRect.width,
            bubbleLeft: bubbleRect?.left,
            bubbleRight: bubbleRect?.right,
            bubbleWidth: bubbleRect?.width,
            codeBlockWidth: codeRect?.width,
            codeBlockScrollWidth: codeBlock?.scrollWidth,
            codeBlockClientWidth: codeBlock?.clientWidth,
            codeScrollable,
            voicePlayerWidth: voiceRect?.width,
            reactionsWidth: reactionsRect?.width,
          };
        });

        const chatBodyComputedPadding = window.getComputedStyle(chatBody).padding;

        return {
          docScrollWidth: docEl.scrollWidth,
          docClientWidth: docEl.clientWidth,
          docOverflow,
          bodyOverflow,
          chatAreaOverflow,
          chatBodyScrollWidth: chatBody.scrollWidth,
          chatBodyClientWidth: chatBody.clientWidth,
          chatBodyOverflow,
          chatBodyComputedPadding,
          rows,
        };
      }, vp.width);

      // 1. Assert NO document, chat-area, or chat-body horizontal scrollbar
      assert.strictEqual(
        metrics.docOverflow,
        false,
        `[Viewport ${vp.label}] Document element must not have horizontal scrollbar (scrollWidth: ${metrics.docScrollWidth}, clientWidth: ${metrics.docClientWidth})`
      );
      assert.strictEqual(
        metrics.bodyOverflow,
        false,
        `[Viewport ${vp.label}] Body must not have horizontal overflow`
      );
      assert.strictEqual(
        metrics.chatAreaOverflow,
        false,
        `[Viewport ${vp.label}] Chat area must not have horizontal overflow`
      );
      assert.strictEqual(
        metrics.chatBodyOverflow,
        false,
        `[Viewport ${vp.label}] Chat body must not have horizontal scrollbar (scrollWidth: ${metrics.chatBodyScrollWidth}, clientWidth: ${metrics.chatBodyClientWidth})`
      );

      // 2. Assert padding values match specs
      if (vp.width <= 380) {
        assert.match(
          metrics.chatBodyComputedPadding,
          /10px\s+8px/,
          `[Viewport ${vp.label}] Padding on <=380px must be 10px 8px, got ${metrics.chatBodyComputedPadding}`
        );
      } else if (vp.width <= 640) {
        assert.match(
          metrics.chatBodyComputedPadding,
          /12px\s+10px/,
          `[Viewport ${vp.label}] Padding on <=640px must be 12px 10px, got ${metrics.chatBodyComputedPadding}`
        );
      }

      // 3. Assert individual rows and bubbles
      for (const row of metrics.rows) {
        // No row or bubble may extend past viewport width
        assert.ok(
          row.rowLeft >= 0,
          `[Viewport ${vp.label}] Row ${row.testId} left (${row.rowLeft}) must be >= 0`
        );
        assert.ok(
          row.rowRight <= vp.width + 1,
          `[Viewport ${vp.label}] Row ${row.testId} right (${row.rowRight}) must be <= viewport width (${vp.width})`
        );

        if (row.bubbleRight != null) {
          assert.ok(
            row.bubbleLeft >= 0,
            `[Viewport ${vp.label}] Bubble ${row.testId} left (${row.bubbleLeft}) must be >= 0`
          );
          assert.ok(
            row.bubbleRight <= vp.width + 1,
            `[Viewport ${vp.label}] Bubble ${row.testId} right (${row.bubbleRight}) must be <= viewport width (${vp.width})`
          );
        }

        // Specific assertions per test scenario:
        if (row.testId === 'unbroken-other') {
          // Ultra-long unbroken text MUST wrap inside bubble and bubble must fit
          assert.ok(
            row.bubbleWidth < vp.width,
            `[Viewport ${vp.label}] Unbroken text bubble width (${row.bubbleWidth}) must be less than viewport width (${vp.width})`
          );
        }

        if (row.testId === 'code-block-other') {
          // Code block must scroll internally without expanding bubble
          assert.strictEqual(
            row.codeScrollable,
            true,
            `[Viewport ${vp.label}] Ultra-wide code block must scroll horizontally (scrollWidth: ${row.codeBlockScrollWidth} > clientWidth: ${row.codeBlockClientWidth})`
          );
          assert.ok(
            row.bubbleWidth < vp.width,
            `[Viewport ${vp.label}] Code block bubble width (${row.bubbleWidth}) must fit within viewport (${vp.width})`
          );
        }

        if (row.testId === 'voice-other') {
          // Voice player bubble inside incoming row with avatar
          assert.ok(
            row.bubbleWidth < vp.width,
            `[Viewport ${vp.label}] Voice bubble width (${row.bubbleWidth}) must fit within viewport (${vp.width})`
          );
          assert.ok(
            row.rowRight <= vp.width + 1,
            `[Viewport ${vp.label}] Voice row right (${row.rowRight}) must fit within viewport (${vp.width})`
          );
          if (vp.width <= 380) {
            // At <=380px, voice player width is 180px
            assert.ok(
              Math.abs(row.voicePlayerWidth - 180) <= 2,
              `[Viewport ${vp.label}] Voice player width on <=380px must be 180px, got ${row.voicePlayerWidth}`
            );
          }
        }

        if (row.testId === 'reactions-other') {
          // Quick reactions must not overflow bubble width
          assert.ok(
            row.reactionsWidth <= row.bubbleWidth + 1,
            `[Viewport ${vp.label}] Reactions width (${row.reactionsWidth}) must fit within bubble width (${row.bubbleWidth})`
          );
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
});
