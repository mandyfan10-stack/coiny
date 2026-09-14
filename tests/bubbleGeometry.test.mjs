import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBubblePath,
  deriveSeriesNeighborhood,
  calculateCornerRadii,
  computeSeriesMergedPath,
  clearBubblePathCache,
  getBubblePathCacheSize
} from '../src/utils/bubbleGeometry.ts';
import {
  detectBubbleGeometryStrategy,
  getBubbleGeometryStrategy,
  isCustomBubbleGeometryEnabled,
  setCustomBubbleGeometryEnabled,
  resetBubbleGeometrySupportCache
} from '../src/utils/bubbleGeometrySupport.ts';

test('deriveSeriesNeighborhood correctly classifies single, first, middle, last messages', () => {
  const baseTime = new Date('2026-09-14T12:00:00Z').getTime();

  const msgAlice1 = { id: '1', senderId: 'alice', timestamp: new Date(baseTime) };
  const msgAlice2 = { id: '2', senderId: 'alice', timestamp: new Date(baseTime + 60 * 1000) };
  const msgAlice3 = { id: '3', senderId: 'alice', timestamp: new Date(baseTime + 120 * 1000) };
  const msgBob = { id: '4', senderId: 'bob', timestamp: new Date(baseTime + 180 * 1000) };
  const msgAliceLate = { id: '5', senderId: 'alice', timestamp: new Date(baseTime + 15 * 60 * 1000) };

  // Single message
  const single = deriveSeriesNeighborhood(msgAlice1, null, msgBob);
  assert.equal(single.seriesPosition, 'single');
  assert.equal(single.isSameSenderAsPrev, false);
  assert.equal(single.isSameSenderAsNext, false);

  // First in group
  const first = deriveSeriesNeighborhood(msgAlice1, null, msgAlice2);
  assert.equal(first.seriesPosition, 'first');
  assert.equal(first.isSameSenderAsPrev, false);
  assert.equal(first.isSameSenderAsNext, true);

  // Middle in group
  const middle = deriveSeriesNeighborhood(msgAlice2, msgAlice1, msgAlice3);
  assert.equal(middle.seriesPosition, 'middle');
  assert.equal(middle.isSameSenderAsPrev, true);
  assert.equal(middle.isSameSenderAsNext, true);

  // Last in group
  const last = deriveSeriesNeighborhood(msgAlice3, msgAlice2, msgBob);
  assert.equal(last.seriesPosition, 'last');
  assert.equal(last.isSameSenderAsPrev, true);
  assert.equal(last.isSameSenderAsNext, false);

  // Exceeding 10 minutes breaks series
  const late = deriveSeriesNeighborhood(msgAliceLate, msgAlice3, null);
  assert.equal(late.seriesPosition, 'single', 'Time delta > 10 min must not cluster');
  assert.equal(late.isSameSenderAsPrev, false);
});

test('calculateCornerRadii collapses neighbour-facing corners in series', () => {
  // Outgoing messages
  const outSingle = calculateCornerRadii('out', 'single');
  assert.deepEqual(outSingle, { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 });

  const outFirst = calculateCornerRadii('out', 'first');
  assert.equal(outFirst.topRight, 16);
  assert.equal(outFirst.bottomRight, 3, 'First outgoing message collapses bottomRight');
  assert.equal(outFirst.topLeft, 16);
  assert.equal(outFirst.bottomLeft, 16);

  const outMiddle = calculateCornerRadii('out', 'middle');
  assert.equal(outMiddle.topRight, 3, 'Middle outgoing message collapses topRight');
  assert.equal(outMiddle.bottomRight, 3, 'Middle outgoing message collapses bottomRight');

  const outLast = calculateCornerRadii('out', 'last');
  assert.equal(outLast.topRight, 3, 'Last outgoing message collapses topRight');
  assert.equal(outLast.bottomRight, 16, 'Last outgoing message keeps outer corner for tail');

  // Incoming messages
  const inFirst = calculateCornerRadii('in', 'first');
  assert.equal(inFirst.bottomLeft, 3, 'First incoming message collapses bottomLeft');
  assert.equal(inFirst.topLeft, 16);

  const inMiddle = calculateCornerRadii('in', 'middle');
  assert.equal(inMiddle.topLeft, 3, 'Middle incoming message collapses topLeft');
  assert.equal(inMiddle.bottomLeft, 3, 'Middle incoming message collapses bottomLeft');

  const inLast = calculateCornerRadii('in', 'last');
  assert.equal(inLast.topLeft, 3, 'Last incoming message collapses topLeft');
  assert.equal(inLast.bottomLeft, 16);

  // Dense collapsing
  const outDense = calculateCornerRadii('out', 'middle', true, true);
  assert.equal(outDense.topRight, 1.5, 'Dense series collapses to 1.5px');
  assert.equal(outDense.bottomRight, 1.5, 'Dense series collapses to 1.5px');
});

test('computeBubblePath generates valid closed SVG path string', () => {
  clearBubblePathCache();
  const path = computeBubblePath({
    width: 220,
    height: 48,
    side: 'out',
    seriesPosition: 'single',
    tail: true
  });

  assert(typeof path === 'string');
  assert(path.startsWith('M '));
  assert(path.endsWith('Z'));
  assert(path.includes('C '));
  assert(path.includes('L '));

  // No NaN or undefined coordinates
  assert(!path.includes('NaN'), 'Path must not contain NaN');
  assert(!path.includes('undefined'), 'Path must not contain undefined');
});

test('computeBubblePath embeds continuous Bezier tail into contour', () => {
  // Outgoing with tail
  const outWithTail = computeBubblePath({
    width: 200,
    height: 60,
    side: 'out',
    seriesPosition: 'single',
    tail: true
  });

  // Outgoing without tail
  const outWithoutTail = computeBubblePath({
    width: 200,
    height: 60,
    side: 'out',
    seriesPosition: 'first',
    tail: false
  });

  assert.notEqual(outWithTail, outWithoutTail, 'Tail presence alters path string');

  // Incoming with tail
  const inWithTail = computeBubblePath({
    width: 200,
    height: 60,
    side: 'in',
    seriesPosition: 'last',
    tail: true
  });

  assert(inWithTail.startsWith('M '));
  assert(inWithTail.endsWith('Z'));
  assert.notEqual(inWithTail, outWithTail, 'Incoming tail mirrors opposite side');
});

test('computeBubblePath integrates reaction dock cutout', () => {
  const withoutReactions = computeBubblePath({
    width: 240,
    height: 70,
    side: 'out',
    seriesPosition: 'single',
    tail: false
  });

  const withReactions = computeBubblePath({
    width: 240,
    height: 70,
    side: 'out',
    seriesPosition: 'single',
    tail: false,
    params: {
      cutout: {
        reactions: {
          width: 72,
          height: 24
        }
      }
    }
  });

  assert.notEqual(withoutReactions, withReactions, 'Reaction dock modifies baseline path');
  assert(withReactions.endsWith('Z'));
  assert(!withReactions.includes('NaN'));
});

test('computeBubblePath dynamically warps path on hover, press and swipe', () => {
  const base = computeBubblePath({
    width: 180,
    height: 50,
    side: 'out',
    seriesPosition: 'single',
    tail: true
  });

  const hovered = computeBubblePath({
    width: 180,
    height: 50,
    side: 'out',
    seriesPosition: 'single',
    tail: true,
    params: { state: { isHovered: true } }
  });

  const pressed = computeBubblePath({
    width: 180,
    height: 50,
    side: 'out',
    seriesPosition: 'single',
    tail: true,
    params: { state: { isPressed: true } }
  });

  const swiped = computeBubblePath({
    width: 180,
    height: 50,
    side: 'out',
    seriesPosition: 'single',
    tail: true,
    params: { state: { swipeOffset: 20 } }
  });

  assert.notEqual(base, hovered, 'Hover state changes tension and radii');
  assert.notEqual(base, pressed, 'Press state softens curvature');
  assert.notEqual(base, swiped, 'Swipe offset pulls tail tip');

  // Reduced motion clamps dynamic warps
  const reducedMotionHover = computeBubblePath({
    width: 180,
    height: 50,
    side: 'out',
    seriesPosition: 'single',
    tail: true,
    params: { state: { isHovered: true, reducedMotion: true } }
  });

  assert.equal(base, reducedMotionHover, 'Reduced motion disables hover warp');
});

test('LRU path caching operates bounded and reaches high throughput', () => {
  clearBubblePathCache();
  assert.equal(getBubblePathCacheSize(), 0);

  const start = Date.now();
  for (let i = 0; i < 10000; i++) {
    computeBubblePath({
      width: 120 + (i % 20),
      height: 40 + (i % 10),
      side: i % 2 === 0 ? 'out' : 'in',
      seriesPosition: 'single',
      tail: true
    });
  }
  const duration = Date.now() - start;

  assert(duration < 150, `10,000 cached evaluations must execute in < 150ms (took ${duration}ms)`);
  assert(getBubblePathCacheSize() <= 600, 'Cache must not exceed 600 entries limit');
});

test('computeSeriesMergedPath unifies multi-item dense bubbles into unbroken silhouette', () => {
  const items = [
    { width: 180, height: 40, offsetTop: 0, side: 'out' },
    { width: 220, height: 50, offsetTop: 42, side: 'out' },
    { width: 160, height: 35, offsetTop: 94, side: 'out', hasTail: true }
  ];

  const merged = computeSeriesMergedPath(items);
  assert(typeof merged === 'string');
  assert(merged.startsWith('M '));
  assert(merged.endsWith('Z'));
  assert(!merged.includes('NaN'));
});

test('bubbleGeometrySupport handles strategy selection and storage toggling', () => {
  resetBubbleGeometrySupportCache();

  // In Node environment without window, returns clip-path-path or fallback
  const strategy = getBubbleGeometryStrategy();
  assert(['clip-path-path', 'svg-mask', 'fallback-border-radius'].includes(strategy));

  // Toggle helper
  assert.equal(typeof isCustomBubbleGeometryEnabled, 'function');
  assert.equal(typeof setCustomBubbleGeometryEnabled, 'function');
  assert.equal(typeof detectBubbleGeometryStrategy, 'function');
});

test('MessageBubble.jsx integrates useBubbleGeometry with full state wiring', async () => {
  const fs = await import('node:fs');
  const messageBubbleJsx = fs.readFileSync(new URL('../src/components/chat/MessageBubble.jsx', import.meta.url), 'utf8');

  assert.match(
    messageBubbleJsx,
    /import\s+useBubbleGeometry\s+from\s+['"]\.\.\/\.\.\/hooks\/useBubbleGeometry['"]/,
    'MessageBubble must import useBubbleGeometry'
  );
  assert.match(
    messageBubbleJsx,
    /const\s+bubbleRef\s*=\s*useRef\(null\);/,
    'MessageBubble must create bubbleRef'
  );
  assert.match(
    messageBubbleJsx,
    /useBubbleGeometry\(bubbleRef,\s*\{[\s\S]*side:\s*isMe\s*\?\s*['"]out['"]\s*:\s*['"]in['"][\s\S]*seriesPosition[\s\S]*hasTail[\s\S]*isHovered[\s\S]*isPressed[\s\S]*\}\)/,
    'MessageBubble must wire useBubbleGeometry with all required parameters'
  );
  assert.match(
    messageBubbleJsx,
    /ref=\{bubbleRef\}/,
    'MessageBubble must attach ref={bubbleRef} to .message-bubble container'
  );
  assert.match(
    messageBubbleJsx,
    /custom-geometry-active/,
    'MessageBubble must attach custom-geometry-active class when active'
  );
  assert.match(
    messageBubbleJsx,
    /\{svgClipElement\}/,
    'MessageBubble must render svgClipElement for svg-mask fallback'
  );
});

test('AppearanceTab.jsx includes toggle for custom bubble geometry', async () => {
  const fs = await import('node:fs');
  const appearanceTabJsx = fs.readFileSync(new URL('../src/components/settings/AppearanceTab.jsx', import.meta.url), 'utf8');

  assert.match(
    appearanceTabJsx,
    /Геометрия сообщений/,
    'AppearanceTab must render section title for bubble geometry'
  );
  assert.match(
    appearanceTabJsx,
    /Параметрические суперэллипсы/,
    'AppearanceTab must explain parametric squircle option'
  );
  assert.match(
    appearanceTabJsx,
    /setCustomBubbleGeometryEnabled/,
    'AppearanceTab must call setCustomBubbleGeometryEnabled on change'
  );
});

test('ChatArea.css styles .message-bubble.custom-geometry-active with zero border-radius and drop-shadow', async () => {
  const fs = await import('node:fs');
  const chatAreaCss = fs.readFileSync(new URL('../src/components/ChatArea.css', import.meta.url), 'utf8');

  assert.match(
    chatAreaCss,
    /\.message-bubble\.custom-geometry-active\s*\{[^}]*border-radius:\s*0\s*!important;[^}]*box-shadow:\s*none\s*!important;[^}]*filter:\s*drop-shadow/s,
    'ChatArea.css must reset border-radius and box-shadow and apply drop-shadow filter'
  );
  assert.match(
    chatAreaCss,
    /\.message-bubble\.custom-geometry-active::before,\s*\.message-bubble\.custom-geometry-active::after\s*\{[^}]*display:\s*none\s*!important;/s,
    'ChatArea.css must suppress pseudo-element tails when custom geometry is active'
  );
});

test('Pure scroll invariance: geometry is not recalculated when dimensions are invariant', () => {
  clearBubblePathCache();
  const w = 210;
  const h = 55;

  // Initial layout evaluation
  const path1 = computeBubblePath({
    width: w,
    height: h,
    side: 'out',
    seriesPosition: 'single',
    tail: true
  });
  const cacheSizeAfterFirst = getBubblePathCacheSize();

  // Simulate 500 scroll frames where element translates in viewport without size change
  for (let frame = 0; frame < 500; frame++) {
    const pathScrolled = computeBubblePath({
      width: w,
      height: h,
      side: 'out',
      seriesPosition: 'single',
      tail: true
    });
    assert.equal(pathScrolled, path1);
  }

  assert.equal(getBubblePathCacheSize(), cacheSizeAfterFirst, 'Cache size must not grow during scroll translation');
});

