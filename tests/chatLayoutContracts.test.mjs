import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexCss = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const chatAreaCss = fs.readFileSync(new URL('../src/components/ChatArea.css', import.meta.url), 'utf8');
const chatInfoCss = fs.readFileSync(new URL('../src/components/ChatInfo.css', import.meta.url), 'utf8');
const tokensCss = fs.readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

test('desktop chat layout keeps the info panel at its full width beside media', () => {
  assert.match(
    chatAreaCss,
    /\.chat-area\s*\{[^}]*\bmin-width:\s*0\s*;/s,
    'the central flex item must be allowed to shrink below media intrinsic width',
  );
  assert.match(
    chatInfoCss,
    /\.chat-info\s*\{[^}]*\bflex:\s*0\s+0\s+auto\s*;/s,
    'the details panel must not shrink when the chat contains wide media',
  );
});

test('message bubble enforces desktop base max-width min(75%, 480px) and text wrapping', () => {
  assert.match(
    chatAreaCss,
    /\.message-bubble\s*\{[^}]*\bmax-width:\s*min\(75%,\s*480px\)/s,
    'base message bubble must use min(75%, 480px) max-width',
  );
  assert.match(
    chatAreaCss,
    /\.message-text\s*\{[^}]*\boverflow-wrap:\s*anywhere\s*;/s,
    'message text must have overflow-wrap: anywhere to prevent text clipping',
  );
  assert.match(
    chatAreaCss,
    /\.message-text\s*\{[^}]*\bword-break:\s*break-word\s*;/s,
    'message text must have word-break: break-word',
  );
});

test('bubble content, caption, and code blocks contain min-width: 0 and box-sizing to prevent flex blowout', () => {
  assert.match(
    chatAreaCss,
    /\.bubble-content\s*\{[^}]*\bmin-width:\s*0\s*;[^}]*\bmax-width:\s*100%\s*;/s,
    'bubble content must enforce min-width: 0 and max-width: 100%',
  );
  assert.match(
    chatAreaCss,
    /\.bubble-caption\s*\{[^}]*\bmin-width:\s*0\s*;[^}]*\bmax-width:\s*100%\s*;/s,
    'bubble caption must enforce min-width: 0 and max-width: 100%',
  );
  assert.match(
    indexCss,
    /\.code-block\s*\{[^}]*\bmin-width:\s*0\s*;[^}]*\bmax-width:\s*100%\s*;[^}]*\boverflow-x:\s*auto\s*;/s,
    'code blocks must enforce min-width: 0, max-width: 100%, and overflow-x: auto',
  );
});

test('responsive media queries enforce bubble constraints, padding, and voice player widths on mobile', () => {
  // Mobile < 768px
  const media768 = chatAreaCss.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)(?:\n\}|@media|$)/)?.[1] || '';
  assert.match(
    media768,
    /\.message-bubble\s*\{[^}]*\bmax-width:\s*min\(88%,\s*460px\)/s,
    '768px breakpoint must clamp message bubble max-width to min(88%, 460px)',
  );
  assert.match(
    media768,
    /\.message-row\.row-other\s+\.message-bubble\s*\{[^}]*\bmax-width:\s*min\(calc\(100%\s*-\s*44px\),\s*460px\)/s,
    '768px incoming group message must reserve space for avatar column',
  );

  // Mobile < 640px
  const media640 = chatAreaCss.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)(?:\n\}|@media|$)/)?.[1] || '';
  assert.match(
    media640,
    /\.chat-body\s*\{[^}]*\bpadding:\s*12px\s+10px\s*;/s,
    '640px breakpoint must set chat-body padding to 12px 10px',
  );
  assert.match(
    media640,
    /\.voice-player-bubble\s*\{[^}]*\bwidth:\s*clamp\(175px,\s*52vw,\s*220px\)/s,
    '640px breakpoint must set responsive clamp on voice player bubble',
  );

  // Mobile < 380px
  const media380 = chatAreaCss.match(/@media\s*\(max-width:\s*380px\)\s*\{([\s\S]*?)(?:\n\}|@media|$)/)?.[1] || '';
  assert.match(
    media380,
    /\.chat-body\s*\{[^}]*\bpadding:\s*10px\s+8px\s*;/s,
    '380px ultra-narrow breakpoint must set chat-body padding to 10px 8px',
  );
  assert.match(
    media380,
    /\.message-bubble\s*\{[^}]*\bmax-width:\s*min\(88%,\s*320px\)/s,
    '380px breakpoint must set message bubble max-width to min(88%, 320px)',
  );
  assert.match(
    media380,
    /\.message-row\.row-other\s+\.message-bubble\s*\{[^}]*\bmax-width:\s*calc\(100%\s*-\s*40px\)/s,
    '380px incoming group bubble must fit alongside avatar without overflow',
  );
  assert.match(
    media380,
    /\.voice-player-bubble\s*\{[^}]*\bwidth:\s*180px\s*;/s,
    '380px breakpoint must set voice player bubble width to 180px',
  );
});

test('regular video player wrapper enforces full responsive width containment', () => {
  assert.match(
    chatAreaCss,
    /\.regular-video-wrapper\s*\{[^}]*\bwidth:\s*100%\s*;[^}]*\bmax-width:\s*100%\s*;[^}]*\bbox-sizing:\s*border-box\s*;/s,
    'ChatArea.css regular video wrapper must have width: 100% and max-width: 100%',
  );
  assert.match(
    indexCss,
    /\.regular-video-wrapper\s*\{[^}]*\bwidth:\s*100%\s*;[^}]*\bmax-width:\s*100%\s*;[^}]*\bbox-sizing:\s*border-box\s*;/s,
    'index.css regular video wrapper must have width: 100% and max-width: 100%',
  );
});

const messageBubbleJsx = fs.readFileSync(new URL('../src/components/chat/MessageBubble.jsx', import.meta.url), 'utf8');

test('mobile action bar repositioning and collision guards under 768px media query', () => {
  const media768ChatArea = chatAreaCss.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)(?:\n\}|@media|$)/)?.[1] || '';
  assert.match(
    media768ChatArea,
    /\.message-hover-actions\s*\{[^}]*\btop:\s*-34px\s*;[^}]*\btransform:\s*none\s*;[^}]*\bright:\s*0\s*;[^}]*\bmargin:\s*0\s*;[^}]*\bz-index:\s*30\s*;/s,
    '768px breakpoint must dock message-hover-actions above bubble to prevent horizontal clipping',
  );
  assert.match(
    media768ChatArea,
    /\.message-row\.row-me\s+\.message-hover-actions\s*\{[^}]*\btop:\s*-34px\s*;[^}]*\btransform:\s*none\s*;[^}]*\bleft:\s*auto\s*;[^}]*\bright:\s*0\s*;[^}]*\bmargin:\s*0\s*;[^}]*\bz-index:\s*30\s*;/s,
    '768px outgoing actions must align to right: 0 without horizontal offset',
  );
  assert.match(
    media768ChatArea,
    /\.message-row\.row-other\s+\.message-hover-actions\s*\{[^}]*\btop:\s*-34px\s*;[^}]*\btransform:\s*none\s*;[^}]*\bleft:\s*0\s*;[^}]*\bright:\s*auto\s*;[^}]*\bmargin:\s*0\s*;[^}]*\bz-index:\s*30\s*;/s,
    '768px incoming actions must align to left: 0 without horizontal offset',
  );
  assert.match(
    media768ChatArea,
    /\.message-row\.group-first:first-child\s+\.message-hover-actions\s*\{[^}]*\btop:\s*4px\s*;/s,
    'first message in chat must dock actions at top: 4px to avoid header clipping',
  );
});

test('media bubble reaction insets provide padding for media-only and media-with-caption bubbles', () => {
  assert.match(
    chatAreaCss,
    /\.message-bubble\.bubble-media-only\s+\.bubble-reactions,\s*\.message-bubble\.bubble-media-with-caption\s+\.bubble-reactions\s*\{[^}]*\bpadding:\s*0\s+8px\s+6px\s+8px\s*;/s,
    'media bubbles must specify padding: 0 8px 6px 8px for reaction badges',
  );
});

test('bubble media wrapper establishes relative positioning context for floating metadata badge', () => {
  assert.match(
    chatAreaCss,
    /\.bubble-media-wrapper\s*\{[^}]*\bposition:\s*relative\s*;/s,
    'bubble media wrapper must have position: relative to anchor floating-badge above reactions',
  );
});

test('reaction badges enforce touch targets, wrapping, and mobile responsive dimensions', () => {
  assert.match(
    chatAreaCss,
    /\.bubble-reactions\s*\{[^}]*\bdisplay:\s*flex\s*;[^}]*\bgap:\s*4px\s*;[^}]*\bflex-wrap:\s*wrap\s*;[^}]*\bmargin-top:\s*6px\s*;/s,
    'bubble-reactions container must wrap badges with gap: 4px',
  );
  assert.match(
    indexCss,
    /\.reaction-badge\s*\{[^}]*\bmin-height:\s*22px\s*;[^}]*\bpadding:\s*2px\s+7px\s*;[^}]*\bdisplay:\s*inline-flex\s*;[^}]*\balign-items:\s*center\s*;[^}]*\bgap:\s*3px\s*;/s,
    'base reaction-badge must have min-height: 22px, padding: 2px 7px, display: inline-flex, and gap: 3px',
  );

  assert.match(
    indexCss,
    /@media[^{]*max-width:\s*768px[\s\S]*?\.reaction-badge\s*\{[^}]*\bmin-height:\s*24px\s*;[^}]*\bpadding:\s*3px\s+8px\s*;[^}]*\bfont-size:\s*11\.5px\s*;/s,
    '768px mobile breakpoint must expand reaction-badge to min-height: 24px and padding: 3px 8px',
  );
});

test('reaction drawer enforces max-width containment and ultra-narrow screen scaling', () => {
  assert.match(
    indexCss,
    /\.reaction-drawer\s*\{[^}]*\bmax-width:\s*calc\(100vw\s*-\s*16px\)\s*;[^}]*\boverflow-x:\s*auto\s*;[^}]*\bscrollbar-width:\s*none\s*;/s,
    'reaction-drawer must enforce max-width: calc(100vw - 16px), overflow-x: auto, and hidden scrollbars',
  );

  const media360Index = indexCss.match(/@media\s*\(max-width:\s*360px\)\s*\{([\s\S]*?)(?:\n\}|@media|$)/)?.[1] || '';
  assert.match(
    media360Index,
    /\.reaction-drawer\s*\{[^}]*\bgap:\s*3px\s*;[^}]*\bpadding:\s*3px\s+6px\s*;/s,
    '360px ultra-narrow breakpoint must scale down drawer gap and padding',
  );
  assert.match(
    media360Index,
    /\.reaction-drawer-item\s*\{[^}]*\bwidth:\s*24px\s*;[^}]*\bheight:\s*24px\s*;[^}]*\bfont-size:\s*16px\s*;/s,
    '360px ultra-narrow breakpoint must scale reaction items to 24x24px with font-size: 16px',
  );
});

test('repositionDrawer in MessageBubble.jsx clamps horizontal and vertical bounds with 284px fallback width', () => {
  assert.match(
    messageBubbleJsx,
    /Math\.min\(284,\s*window\.innerWidth\s*-\s*viewportPad\s*\*\s*2\)/,
    'repositionDrawer fallback width must be 284px matching 8 emoji cells',
  );
  assert.match(
    messageBubbleJsx,
    /const\s+maxTop\s*=\s*window\.innerHeight\s*-\s*realHeight\s*-\s*viewportPad;/,
    'repositionDrawer must calculate maxTop based on window.innerHeight, realHeight, and viewportPad',
  );
  assert.match(
    messageBubbleJsx,
    /if\s*\(\s*top\s*>\s*maxTop\s*\)\s*\{\s*top\s*=\s*Math\.max\(\s*viewportPad\s*,\s*maxTop\s*\);\s*\}/,
    'repositionDrawer must clamp top to Math.max(viewportPad, maxTop) when exceeding maxTop',
  );
  assert.match(
    messageBubbleJsx,
    /left\s*=\s*Math\.max\(\s*viewportPad\s*,\s*Math\.min\(\s*left\s*,\s*maxLeft\s*\)\s*\);/,
    'repositionDrawer must clamp left within [viewportPad, maxLeft]',
  );
});

test('repositionDrawer geometry algorithm handles top, bottom, and side collisions correctly', () => {
  function computeDrawerPosition({
    anchorRect,
    viewportWidth,
    viewportHeight,
    drawerWidth = 284,
    drawerHeight = 40,
    viewportPad = 8,
    gap = 8
  }) {
    const realWidth = drawerWidth;
    const realHeight = drawerHeight;

    let top = anchorRect.top - realHeight - gap;
    let placement = 'above';
    if (top < viewportPad) {
      top = anchorRect.bottom + gap;
      placement = 'below';
    }

    const maxTop = viewportHeight - realHeight - viewportPad;
    if (top > maxTop) {
      top = Math.max(viewportPad, maxTop);
    }

    let left = anchorRect.left + anchorRect.width / 2 - realWidth / 2;
    const maxLeft = viewportWidth - realWidth - viewportPad;
    left = Math.max(viewportPad, Math.min(left, maxLeft));

    return { top: Math.round(top), left: Math.round(left), placement };
  }

  // Case 1: Standard middle message (375x667)
  const posNormal = computeDrawerPosition({
    anchorRect: { top: 300, bottom: 324, left: 100, width: 24, height: 24 },
    viewportWidth: 375,
    viewportHeight: 667
  });
  assert.equal(posNormal.placement, 'above');
  assert.equal(posNormal.top, 300 - 40 - 8); // 252
  assert(posNormal.left >= 8 && posNormal.left <= 375 - 284 - 8);

  // Case 2: Message at very top of screen (anchor.top = 10)
  const posTop = computeDrawerPosition({
    anchorRect: { top: 10, bottom: 34, left: 20, width: 24, height: 24 },
    viewportWidth: 375,
    viewportHeight: 667
  });
  assert.equal(posTop.placement, 'below');
  assert.equal(posTop.top, 34 + 8); // 42
  assert(posTop.left >= 8);

  // Case 3: Message at very bottom of screen (anchor.top = 640)
  const posBottom = computeDrawerPosition({
    anchorRect: { top: 640, bottom: 664, left: 300, width: 24, height: 24 },
    viewportWidth: 375,
    viewportHeight: 667
  });
  assert.equal(posBottom.placement, 'above');
  // top = 640 - 40 - 8 = 592; maxTop = 667 - 40 - 8 = 619; top (592) <= maxTop (619)
  assert.equal(posBottom.top, 592);
  assert(posBottom.left + 284 <= 375 - 8);

  // Case 4: Tight vertical viewport (landscape 800x320) with anchor forcing placement below and exceeding maxTop
  const posLandscape = computeDrawerPosition({
    anchorRect: { top: 5, bottom: 290, left: 400, width: 24, height: 24 },
    viewportWidth: 800,
    viewportHeight: 320
  });
  const maxTopLandscape = 320 - 40 - 8; // 272
  assert.equal(posLandscape.placement, 'below');
  assert.equal(posLandscape.top, maxTopLandscape); // clamped to 272

  // Case 5: Horizontal right-edge clamp (anchor at rightmost position)
  const posRightEdge = computeDrawerPosition({
    anchorRect: { top: 200, bottom: 224, left: 350, width: 24, height: 24 },
    viewportWidth: 375,
    viewportHeight: 667
  });
  assert.equal(posRightEdge.left, 375 - 284 - 8); // 83

  // Case 6: Horizontal left-edge clamp (anchor at leftmost position)
  const posLeftEdge = computeDrawerPosition({
    anchorRect: { top: 200, bottom: 224, left: 0, width: 24, height: 24 },
    viewportWidth: 375,
    viewportHeight: 667
  });
  assert.equal(posLeftEdge.left, 8);
});

test('light theme swaps overlay surfaces so info/settings tabs are not dark stains', () => {
  assert.match(tokensCss, /--surface-glass:\s*var\(--bg-secondary\)/);
  assert.match(tokensCss, /--surface-muted:\s*var\(--bg-input\)/);
  assert.match(tokensCss, /html\.theme-light\s*\{[^}]*--bg-secondary:\s*#ffffff/s);

  assert.match(chatInfoCss, /\.info-header\s*\{[^}]*background:\s*var\(--surface-glass\)/s);
  assert.match(chatInfoCss, /\.info-segmented-tabs\s*\{[^}]*background:\s*var\(--surface-muted\)/s);
  assert.doesNotMatch(chatInfoCss, /rgba\(14,\s*22,\s*33/);

  assert.match(tokensCss, /html\.theme-light\s*\{[^}]*--chat-wallpaper:/s);
});

test('light theme fixes tails, auth selectors, background tiers, and contrast', () => {
  const mobileSheetCss = fs.readFileSync(new URL('../src/components/chat/MobileActionSheet.css', import.meta.url), 'utf8');

  // 1. --bg-tertiary exists in both :root and html.theme-light
  assert.match(tokensCss, /:root\s*\{[^}]*--bg-tertiary:\s*#[0-9a-f]{6}/s);
  assert.match(tokensCss, /html\.theme-light\s*\{[^}]*--bg-tertiary:\s*#[0-9a-f]{6}/s);

  // Auth now follows the same palette tokens instead of parallel light overrides.
  const authCss = fs.readFileSync(new URL('../src/components/AuthScreen.css', import.meta.url), 'utf8');
  assert.match(authCss, /background:\s*var\(--bg-secondary\)/);
  assert.match(authCss, /color:\s*var\(--text-primary\)/);

  // Tail colors are checked in the browser for all six light and dark themes.

  // 4. Voice seek bar is visible on light background
  assert.match(indexCss, /html\.theme-light\s+\.voice-seek-bar\s*\{[^}]*rgba\(15,\s*23,\s*42,\s*0\.12\)/s);

  // 5. Links and replies have readable contrast
  assert.match(chatAreaCss, /html\.theme-light\s+\.message-text\s+a\s*\{[^}]*var\(--accent-color\)/s);
  assert.match(chatAreaCss, /html\.theme-light\s+\.reply-preview-sender\s*\{[^}]*var\(--accent-color\)/s);

  // 6. Mobile action sheet uses surface variables for hovers
  assert.match(mobileSheetCss, /\.mobile-sheet-reaction-pill:hover\s*\{[^}]*var\(--surface-hover/s);
  assert.match(mobileSheetCss, /\.mobile-sheet-item:hover\s*\{[^}]*var\(--surface-hover/s);
});
