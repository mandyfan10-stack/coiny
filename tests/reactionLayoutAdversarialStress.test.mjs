import test from 'node:test';
import assert from 'node:assert/strict';
import { messengerFixtureCss } from './messengerFixtureCss.mjs';
import { chromium } from 'playwright';

const combinedCss = messengerFixtureCss();

function buildReactionHtml({ reactionCount = 8 } = {}) {
  const emojiList = [
    { emoji: '👍', count: 12 },
    { emoji: '❤️', count: 8 },
    { emoji: '🔥', count: 24 },
    { emoji: '🎉', count: 5 },
    { emoji: '🚀', count: 19 },
    { emoji: '👏', count: 7 },
    { emoji: '😍', count: 14 },
    { emoji: '💯', count: 33 },
    { emoji: '😂', count: 42 },
    { emoji: '🤩', count: 17 }
  ];

  const renderedReactions = emojiList.slice(0, reactionCount).map((r, i) =>
    `<button class="reaction-badge ${i === 0 ? 'active' : ''}">${r.emoji} <span class="react-count">${r.count}</span></button>`
  ).join('\n');

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
        <div class="chat-body" id="test-chat-body">
          <div class="messages-list">

            <!-- 1. Text message (incoming, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="text-incoming">
              <div class="message-avatar-col"><div class="message-sender-avatar">👤</div></div>
              <div class="message-bubble bubble-other">
                <div class="bubble-content">
                  <p class="message-text">
                    <span>Short text message with reactions</span>
                    <span class="bubble-metadata"><span class="message-time">12:00</span></span>
                  </p>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 2. Text message (outgoing) -->
            <div class="message-row row-me group-first group-last" data-test="text-outgoing">
              <div class="message-bubble bubble-me">
                <div class="bubble-content">
                  <p class="message-text">
                    <span>Outgoing message with multiple reaction badges</span>
                    <span class="bubble-metadata"><span class="message-time">12:01</span></span>
                  </p>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 3. Pure Photo (incoming, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="pure-photo-incoming">
              <div class="message-avatar-col"><div class="message-sender-avatar">👤</div></div>
              <div class="message-bubble bubble-other bubble-media-only">
                <div class="bubble-media-wrapper">
                  <button type="button" class="bubble-media-open">
                    <div class="bubble-media" style="width: 240px; height: 160px; background: #2a3b4c; border-radius: inherit;"></div>
                  </button>
                  <span class="bubble-metadata floating-badge"><span class="message-time">12:02</span></span>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 4. Captioned Photo (outgoing) -->
            <div class="message-row row-me group-first group-last" data-test="captioned-photo-outgoing">
              <div class="message-bubble bubble-me bubble-media-with-caption">
                <div class="bubble-media-wrapper">
                  <button type="button" class="bubble-media-open">
                    <div class="bubble-media" style="width: 240px; height: 160px; background: #2a3b4c; border-radius: 14px 14px 0 0;"></div>
                  </button>
                </div>
                <div class="bubble-caption">
                  <p class="message-text">
                    <span>Captioned photo description test</span>
                    <span class="bubble-metadata"><span class="message-time">12:03</span></span>
                  </p>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 5. Pure Video (incoming, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="pure-video-incoming">
              <div class="message-avatar-col"><div class="message-sender-avatar">👤</div></div>
              <div class="message-bubble bubble-other bubble-media-only">
                <div class="bubble-media-wrapper">
                  <div class="regular-video-wrapper" style="width: 240px; height: 150px; background: #000;">
                    <video style="width: 100%; height: 100%; object-fit: cover;"></video>
                  </div>
                  <span class="bubble-metadata floating-badge"><span class="message-time">12:04</span></span>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 6. Captioned Video (outgoing) -->
            <div class="message-row row-me group-first group-last" data-test="captioned-video-outgoing">
              <div class="message-bubble bubble-me bubble-media-with-caption">
                <div class="bubble-media-wrapper">
                  <div class="regular-video-wrapper" style="width: 240px; height: 150px; background: #000;">
                    <video style="width: 100%; height: 100%; object-fit: cover;"></video>
                  </div>
                </div>
                <div class="bubble-caption">
                  <p class="message-text">
                    <span>Captioned video description test</span>
                    <span class="bubble-metadata"><span class="message-time">12:05</span></span>
                  </p>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 7. Voice Note (incoming, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="voice-incoming">
              <div class="message-avatar-col"><div class="message-sender-avatar">👤</div></div>
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
                    <span class="bubble-metadata"><span class="message-time">12:06</span></span>
                  </div>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 8. Sticker (outgoing) -->
            <div class="message-row row-me group-first group-last" data-test="sticker-outgoing">
              <div class="message-bubble bubble-me bubble-sticker">
                <div style="position: relative; display: inline-block;">
                  <div style="width: 120px; height: 120px; background: #444; border-radius: 12px;"></div>
                  <span class="bubble-metadata floating-badge sticker-metadata"><span class="message-time">12:07</span></span>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

            <!-- 9. Circular Video Note (incoming, with avatar) -->
            <div class="message-row row-other group-first group-last" data-test="video-note-incoming">
              <div class="message-avatar-col"><div class="message-sender-avatar">👤</div></div>
              <div class="message-bubble bubble-other bubble-video">
                <div style="position: relative;">
                  <div style="width: 180px; height: 180px; border-radius: 50%; background: #222;"></div>
                  <span class="bubble-metadata floating-badge"><span class="message-time">12:08</span></span>
                </div>
                <div class="bubble-reactions">
                  ${renderedReactions}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

const VIEWPORTS = [
  { width: 360, height: 740, label: '360px Compact Mobile' },
  { width: 375, height: 667, label: '375px iPhone SE/7/8' },
  { width: 412, height: 915, label: '412px Standard Mobile' },
  { width: 768, height: 1024, label: '768px Tablet' }
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

test('EMPIRICAL EVALUATION: Reaction badges multi-line wrapping and bounds containment across 360px/375px/412px/768px', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;

  try {
    for (const reactionCount of [5, 8, 10]) {
      const html = buildReactionHtml({ reactionCount });

      for (const vp of VIEWPORTS) {
        const page = await browser.newPage({
          viewport: { width: vp.width, height: vp.height }
        });

        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(50);

        const results = await page.evaluate(() => {
          const docEl = document.documentElement;
          const bodyEl = document.body;
          const chatBody = document.getElementById('test-chat-body');

          const docOverflow = docEl.scrollWidth > docEl.clientWidth;
          const bodyOverflow = bodyEl.scrollWidth > bodyEl.clientWidth;
          const chatBodyOverflow = chatBody.scrollWidth > chatBody.clientWidth;

          const rows = [...document.querySelectorAll('.message-row')].map((row) => {
            const testId = row.getAttribute('data-test');
            const rowRect = row.getBoundingClientRect();
            const bubble = row.querySelector('.message-bubble');
            const bubbleRect = bubble ? bubble.getBoundingClientRect() : null;
            const reactions = row.querySelector('.bubble-reactions');
            const reactionsRect = reactions ? reactions.getBoundingClientRect() : null;
            const metadata = row.querySelector('.bubble-metadata');
            const metadataRect = metadata ? metadata.getBoundingClientRect() : null;

            const badges = [...row.querySelectorAll('.reaction-badge')].map((b) => {
              const rect = b.getBoundingClientRect();
              return {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height
              };
            });

            const uniqueY = new Set(badges.map(b => Math.round(b.top)));
            const lineCount = uniqueY.size;

            const badgesFitInBubble = badges.every(b =>
              b.left >= bubbleRect.left - 1 &&
              b.right <= bubbleRect.right + 1
            );

            let metadataOverlap = false;
            if (metadataRect && reactionsRect) {
              const noOverlap = (
                metadataRect.right <= reactionsRect.left ||
                metadataRect.left >= reactionsRect.right ||
                metadataRect.bottom <= reactionsRect.top ||
                metadataRect.top >= reactionsRect.bottom
              );
              metadataOverlap = !noOverlap;
            }

            return {
              testId,
              rowWidth: rowRect.width,
              bubbleWidth: bubbleRect?.width,
              bubbleHeight: bubbleRect?.height,
              bubbleLeft: bubbleRect?.left,
              bubbleRight: bubbleRect?.right,
              reactionsWidth: reactionsRect?.width,
              reactionsHeight: reactionsRect?.height,
              reactionsTop: reactionsRect?.top,
              reactionsBottom: reactionsRect?.bottom,
              metadataTop: metadataRect?.top,
              metadataBottom: metadataRect?.bottom,
              metadataLeft: metadataRect?.left,
              metadataRight: metadataRect?.right,
              lineCount,
              badgeCount: badges.length,
              badgesFitInBubble,
              metadataOverlap,
              badgeMinHeight: badges.reduce((min, b) => Math.min(min, b.height), 999),
              badgeMinWidth: badges.reduce((min, b) => Math.min(min, b.width), 999)
            };
          });

          return {
            docOverflow,
            bodyOverflow,
            chatBodyOverflow,
            rows
          };
        });

        assert.strictEqual(
          results.docOverflow,
          false,
          `[Viewport ${vp.label}, ${reactionCount} reactions] Document must not overflow horizontally`
        );
        assert.strictEqual(
          results.bodyOverflow,
          false,
          `[Viewport ${vp.label}, ${reactionCount} reactions] Body must not overflow horizontally`
        );
        assert.strictEqual(
          results.chatBodyOverflow,
          false,
          `[Viewport ${vp.label}, ${reactionCount} reactions] ChatBody must not overflow horizontally`
        );

        for (const row of results.rows) {
          assert.ok(
            row.reactionsWidth <= row.bubbleWidth + 1,
            `[Viewport ${vp.label}, ${reactionCount} reactions, ${row.testId}] Reactions width (${row.reactionsWidth}) must fit within bubble (${row.bubbleWidth})`
          );

          assert.strictEqual(
            row.badgesFitInBubble,
            true,
            `[Viewport ${vp.label}, ${reactionCount} reactions, ${row.testId}] Badges must fit inside bubble boundaries`
          );

          if (reactionCount >= 8 && vp.width <= 375) {
            assert.ok(
              row.lineCount >= 2,
              `[Viewport ${vp.label}, ${reactionCount} reactions, ${row.testId}] Reactions should wrap to at least 2 lines (got ${row.lineCount} lines)`
            );
          }

          assert.strictEqual(
            row.metadataOverlap,
            false,
            `[Viewport ${vp.label}, ${reactionCount} reactions, ${row.testId}] Reactions must not overlap timestamp metadata`
          );

          if (vp.width <= 768) {
            assert.ok(
              row.badgeMinHeight >= 22,
              `[Viewport ${vp.label}, ${reactionCount} reactions, ${row.testId}] Reaction badge height (${row.badgeMinHeight}) must be >= 22px`
            );
          }
        }

        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test('EMPIRICAL VERIFICATION: Pure photo/video floating badge anchors to media wrapper without overlapping reactions', async () => {
  const browser = await launchBrowserSafely();
  if (!browser) return;

  try {
    const html = buildReactionHtml({ reactionCount: 5 });
    const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(50);

    const overlapResult = await page.evaluate(() => {
      const photoRow = document.querySelector('[data-test="pure-photo-incoming"]');
      const photoMeta = photoRow.querySelector('.bubble-metadata');
      const photoReactions = photoRow.querySelector('.bubble-reactions');
      const photoMetaRect = photoMeta.getBoundingClientRect();
      const photoReactionsRect = photoReactions.getBoundingClientRect();

      const photoOverlaps = !(
        photoMetaRect.right <= photoReactionsRect.left ||
        photoMetaRect.left >= photoReactionsRect.right ||
        photoMetaRect.bottom <= photoReactionsRect.top ||
        photoMetaRect.top >= photoReactionsRect.bottom
      );

      const videoRow = document.querySelector('[data-test="pure-video-incoming"]');
      const videoMeta = videoRow.querySelector('.bubble-metadata');
      const videoReactions = videoRow.querySelector('.bubble-reactions');
      const videoMetaRect = videoMeta.getBoundingClientRect();
      const videoReactionsRect = videoReactions.getBoundingClientRect();

      const videoOverlaps = !(
        videoMetaRect.right <= videoReactionsRect.left ||
        videoMetaRect.left >= videoReactionsRect.right ||
        videoMetaRect.bottom <= videoReactionsRect.top ||
        videoMetaRect.top >= videoReactionsRect.bottom
      );

      return { photoOverlaps, videoOverlaps, photoMetaRect, photoReactionsRect };
    });

    await page.close();

    assert.strictEqual(
      overlapResult.photoOverlaps,
      false,
      'Pure photo floating metadata must anchor to media wrapper and never overlap reaction badges'
    );
    assert.strictEqual(
      overlapResult.videoOverlaps,
      false,
      'Pure video floating metadata must anchor to media wrapper and never overlap reaction badges'
    );
  } finally {
    await browser.close();
  }
});
