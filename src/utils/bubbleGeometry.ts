/**
 * bubbleGeometry.ts
 *
 * Single source of truth for parametric chat bubble shapes in Coiny.
 * Computes SVG path strings for superellipses (squircles) with G2-continuous
 * cubic Bezier curves, independent corner radii, continuous Bezier tails,
 * series neighbourhood corner collapsing, dense series blending,
 * reaction/timestamp cutouts, and dynamic gesture/state warps.
 */

export type BubbleSide = 'in' | 'out';
export type SeriesPosition = 'single' | 'first' | 'middle' | 'last';

export interface BubbleCornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface CutoutParams {
  reactions?: {
    width: number;
    height: number;
    offset?: number;
  };
  timestamp?: {
    width: number;
    height: number;
  };
}

export interface BubbleStateParams {
  isHovered?: boolean;
  isPressed?: boolean;
  swipeOffset?: number;
  isPending?: boolean;
  reducedMotion?: boolean;
}

export interface BubbleGeometryInput {
  width: number;
  height: number;
  side: BubbleSide;
  seriesPosition: SeriesPosition;
  tail: boolean;
  params?: {
    tension?: number;
    tailWidth?: number;
    tailHeight?: number;
    tailPlacement?: 'inside' | 'outside';
    radii?: Partial<BubbleCornerRadii>;
    cutout?: CutoutParams;
    state?: BubbleStateParams;
    denseNext?: boolean;
    densePrev?: boolean;
    gap?: number;
    rtl?: boolean;
  };
}

export interface SeriesNeighborhoodMessage {
  id?: string;
  senderId?: string;
  sender_id?: string;
  senderName?: string;
  timestamp: string | number | Date;
}

const DEFAULT_BASE_RADIUS = 16;
const DEFAULT_COLLAPSED_RADIUS = 3;
const DEFAULT_DENSE_COLLAPSED_RADIUS = 1.5;
const DEFAULT_TAIL_WIDTH = 7.5;
const DEFAULT_TAIL_HEIGHT = 13;
const DEFAULT_TENSION = 0.72;
const TIME_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * LRU / bounded Map cache for computed SVG path strings.
 * Keyed by rounded dimensions, series configuration, state, and cutouts.
 */
const PATH_CACHE_LIMIT = 600;
const pathCache = new Map<string, string>();

export function clearBubblePathCache(): void {
  pathCache.clear();
}

export function getBubblePathCacheSize(): number {
  return pathCache.size;
}

/**
 * Derives series neighborhood position ('single' | 'first' | 'middle' | 'last')
 * based on sender identity and a 10-minute threshold.
 */
export function deriveSeriesNeighborhood(
  msg: SeriesNeighborhoodMessage | null | undefined,
  prevMsg: SeriesNeighborhoodMessage | null | undefined,
  nextMsg: SeriesNeighborhoodMessage | null | undefined,
  thresholdMs: number = TIME_THRESHOLD_MS
): {
  isSameSenderAsPrev: boolean;
  isSameSenderAsNext: boolean;
  seriesPosition: SeriesPosition;
} {
  if (!msg) {
    return {
      isSameSenderAsPrev: false,
      isSameSenderAsNext: false,
      seriesPosition: 'single'
    };
  }

  const getSenderKey = (m: SeriesNeighborhoodMessage | null | undefined): string | null => {
    if (!m) return null;
    return m.senderId || m.sender_id || m.senderName || null;
  };

  const currKey = getSenderKey(msg);
  const prevKey = getSenderKey(prevMsg);
  const nextKey = getSenderKey(nextMsg);

  const currTime = new Date(msg.timestamp).getTime();
  const prevTime = prevMsg ? new Date(prevMsg.timestamp).getTime() : NaN;
  const nextTime = nextMsg ? new Date(nextMsg.timestamp).getTime() : NaN;

  const isSameSenderAsPrev = Boolean(
    prevMsg &&
    prevKey &&
    currKey &&
    prevKey === currKey &&
    !Number.isNaN(currTime) &&
    !Number.isNaN(prevTime) &&
    Math.abs(currTime - prevTime) < thresholdMs
  );

  const isSameSenderAsNext = Boolean(
    nextMsg &&
    nextKey &&
    currKey &&
    nextKey === currKey &&
    !Number.isNaN(currTime) &&
    !Number.isNaN(nextTime) &&
    Math.abs(nextTime - currTime) < thresholdMs
  );

  let seriesPosition: SeriesPosition = 'single';
  if (!isSameSenderAsPrev && !isSameSenderAsNext) {
    seriesPosition = 'single';
  } else if (!isSameSenderAsPrev && isSameSenderAsNext) {
    seriesPosition = 'first';
  } else if (isSameSenderAsPrev && isSameSenderAsNext) {
    seriesPosition = 'middle';
  } else {
    seriesPosition = 'last';
  }

  return {
    isSameSenderAsPrev,
    isSameSenderAsNext,
    seriesPosition
  };
}

/**
 * Calculates corner radii for a bubble given its side, series position, and density.
 */
export function calculateCornerRadii(
  side: BubbleSide,
  seriesPosition: SeriesPosition,
  denseNext: boolean = false,
  densePrev: boolean = false,
  customRadii?: Partial<BubbleCornerRadii>
): BubbleCornerRadii {
  const baseR = DEFAULT_BASE_RADIUS;
  const smallR = densePrev || denseNext ? DEFAULT_DENSE_COLLAPSED_RADIUS : DEFAULT_COLLAPSED_RADIUS;

  let topLeft = baseR;
  let topRight = baseR;
  let bottomRight = baseR;
  let bottomLeft = baseR;

  if (side === 'out') {
    // Outgoing messages: neighbour corners collapse on the right (outer wall)
    if (seriesPosition === 'first') {
      bottomRight = denseNext ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
    } else if (seriesPosition === 'middle') {
      topRight = densePrev ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
      bottomRight = denseNext ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
    } else if (seriesPosition === 'last') {
      topRight = densePrev ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
    }
  } else {
    // Incoming messages: neighbour corners collapse on the left (avatar side)
    if (seriesPosition === 'first') {
      bottomLeft = denseNext ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
    } else if (seriesPosition === 'middle') {
      topLeft = densePrev ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
      bottomLeft = denseNext ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
    } else if (seriesPosition === 'last') {
      topLeft = densePrev ? DEFAULT_DENSE_COLLAPSED_RADIUS : smallR;
    }
  }

  return {
    topLeft: customRadii?.topLeft ?? topLeft,
    topRight: customRadii?.topRight ?? topRight,
    bottomRight: customRadii?.bottomRight ?? bottomRight,
    bottomLeft: customRadii?.bottomLeft ?? bottomLeft
  };
}

/**
 * Formats float coordinate to 2 decimal places to minimize SVG path size
 * while avoiding precision drift.
 */
function f(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Main parametric path generator.
 * Builds an SVG path string from dimensions, side, series position, tail and state params.
 */
export function computeBubblePath(input: BubbleGeometryInput): string {
  const width = Math.max(24, Math.round(input.width));
  const height = Math.max(20, Math.round(input.height));
  const side = input.side;
  const seriesPosition = input.seriesPosition;
  const hasTail = Boolean(input.tail);

  const params = input.params || {};
  const state = params.state || {};
  const isReducedMotion = Boolean(state.reducedMotion);

  // Dynamic state modulations
  let tension = params.tension ?? DEFAULT_TENSION;
  if (!isReducedMotion) {
    if (state.isHovered) tension += 0.07;
    if (state.isPressed) tension -= 0.09;
    if (state.isPending) tension += 0.03;
  }
  tension = Math.max(0.4, Math.min(0.95, tension));

  const tailWidth = params.tailWidth ?? DEFAULT_TAIL_WIDTH;
  const tailHeight = params.tailHeight ?? DEFAULT_TAIL_HEIGHT;
  const tailPlacement = params.tailPlacement ?? 'inside';
  const denseNext = Boolean(params.denseNext);
  const densePrev = Boolean(params.densePrev);

  const swipeOffset = !isReducedMotion && typeof state.swipeOffset === 'number'
    ? Math.max(-28, Math.min(28, state.swipeOffset))
    : 0;

  // Build cache key
  const cutout = params.cutout;
  const reactionKey = cutout?.reactions ? `${Math.round(cutout.reactions.width)}x${Math.round(cutout.reactions.height)}` : '0';
  const timestampKey = cutout?.timestamp ? `${Math.round(cutout.timestamp.width)}x${Math.round(cutout.timestamp.height)}` : '0';
  const stateKey = `${state.isHovered ? 1 : 0}_${state.isPressed ? 1 : 0}_${Math.round(swipeOffset)}_${state.isPending ? 1 : 0}_${isReducedMotion ? 1 : 0}`;
  const cacheKey = `${width}_${height}_${side}_${seriesPosition}_${hasTail ? 1 : 0}_${tailPlacement}_${denseNext ? 1 : 0}_${densePrev ? 1 : 0}_${reactionKey}_${timestampKey}_${stateKey}`;

  const cached = pathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Calculate corner radii with state adjustments
  let radii = calculateCornerRadii(side, seriesPosition, denseNext, densePrev, params.radii);
  if (!isReducedMotion) {
    if (state.isHovered) {
      radii = {
        topLeft: radii.topLeft + 0.8,
        topRight: radii.topRight + 0.8,
        bottomRight: radii.bottomRight + 0.8,
        bottomLeft: radii.bottomLeft + 0.8
      };
    } else if (state.isPressed) {
      radii = {
        topLeft: Math.max(2, radii.topLeft - 1),
        topRight: Math.max(2, radii.topRight - 1),
        bottomRight: Math.max(2, radii.bottomRight - 1),
        bottomLeft: Math.max(2, radii.bottomLeft - 1)
      };
    }
  }

  // Define geometric bounding box based on tail placement
  let x0 = 0;
  let x1 = width;
  const y0 = 0;
  const y1 = height;

  if (hasTail && tailPlacement === 'inside') {
    if (side === 'out') {
      x1 = width - tailWidth;
    } else {
      x0 = tailWidth;
    }
  }

  const effectiveW = x1 - x0;
  const effectiveH = y1 - y0;

  // Clamp radii so adjacent corners do not overlap
  const maxAllowedR = Math.min(effectiveW / 2, effectiveH / 2);
  const rtl = Math.min(radii.topLeft, maxAllowedR);
  const rtr = Math.min(radii.topRight, maxAllowedR);
  const rbr = Math.min(radii.bottomRight, maxAllowedR);
  const rbl = Math.min(radii.bottomLeft, maxAllowedR);

  // Squircle corner extent calculation:
  // For standard circular arc: extent = R.
  // For superellipse squircle: corner extent along edge is extended by factor (1 + 0.22 * tension)
  const extentFactor = 1 + 0.22 * tension;
  const ltl = Math.min(rtl * extentFactor, effectiveW / 2, effectiveH / 2);
  const ltr = Math.min(rtr * extentFactor, effectiveW / 2, effectiveH / 2);
  const lbr = Math.min(rbr * extentFactor, effectiveW / 2, effectiveH / 2);
  const lbl = Math.min(rbl * extentFactor, effectiveW / 2, effectiveH / 2);

  // Bezier control point tension
  // Standard circular Bezier constant: kappa = 0.55228475
  const kappa = 0.5523 + 0.16 * tension;

  const pathParts: string[] = [];

  // 1. Start on top edge after top-left corner
  pathParts.push(`M ${f(x0 + ltl)} ${f(y0)}`);

  // 2. Top edge straight segment to top-right corner start
  pathParts.push(`L ${f(x1 - ltr)} ${f(y0)}`);

  // 3. Top-Right squircle corner
  if (ltr > 0.5) {
    const cp1x = x1 - ltr + ltr * kappa;
    const cp1y = y0;
    const cp2x = x1;
    const cp2y = y0 + ltr - ltr * kappa;
    pathParts.push(`C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(x1)} ${f(y0 + ltr)}`);
  } else {
    pathParts.push(`L ${f(x1)} ${f(y0)}`);
  }

  // 4. Right edge downwards
  if (hasTail && side === 'out') {
    // Outgoing with continuous Bezier tail at bottom-right
    const tailStartY = Math.max(y0 + ltr, y1 - tailHeight);
    pathParts.push(`L ${f(x1)} ${f(tailStartY)}`);

    // Tail tip position
    const tipX = tailPlacement === 'inside'
      ? width + swipeOffset * 0.35
      : x1 + tailWidth + swipeOffset * 0.35;
    const tipY = y1 + (state.isPending && !isReducedMotion ? -1.5 : 0);

    // Continuous cubic Bezier curving outward to tail tip
    const cpOut1X = x1 + (tipX - x1) * 0.22;
    const cpOut1Y = tailStartY + (tipY - tailStartY) * 0.55;
    const cpOut2X = x1 + (tipX - x1) * 0.65;
    const cpOut2Y = tipY - 0.8;
    pathParts.push(`C ${f(cpOut1X)} ${f(cpOut1Y)}, ${f(cpOut2X)} ${f(cpOut2Y)}, ${f(tipX)} ${f(tipY)}`);

    // Return curve from tail tip back into the baseline
    const baseReturnX = x1 - Math.max(3, lbr * 0.65);
    const cpIn1X = tipX - (tipX - baseReturnX) * 0.45;
    const cpIn1Y = tipY;
    const cpIn2X = baseReturnX + 2;
    const cpIn2Y = y1;
    pathParts.push(`C ${f(cpIn1X)} ${f(cpIn1Y)}, ${f(cpIn2X)} ${f(cpIn2Y)}, ${f(baseReturnX)} ${f(y1)}`);
  } else {
    // Standard right edge down to bottom-right corner start
    pathParts.push(`L ${f(x1)} ${f(y1 - lbr)}`);

    // Bottom-Right squircle corner
    if (lbr > 0.5) {
      const cp1x = x1;
      const cp1y = y1 - lbr + lbr * kappa;
      const cp2x = x1 - lbr + lbr * kappa;
      const cp2y = y1;
      pathParts.push(`C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(x1 - lbr)} ${f(y1)}`);
    } else {
      pathParts.push(`L ${f(x1)} ${f(y1)}`);
    }
  }

  // 5. Bottom edge (incorporating reaction dock lobe if present)
  const hasReactions = Boolean(cutout?.reactions && cutout.reactions.width > 10);
  if (hasReactions && cutout?.reactions) {
    const rxW = Math.min(cutout.reactions.width, effectiveW - 20);
    const rxH = Math.min(cutout.reactions.height, 36);
    const rxOffset = cutout.reactions.offset ?? (side === 'out' ? 14 : 14);

    // Dock lobe placement: clamped cleanly between bottom-left and bottom-right corners
    const maxDockRight = x1 - lbr - 2;
    const minDockLeft = x0 + lbl + 2;
    let dockRight = side === 'out' ? x1 - rxOffset : x0 + rxOffset + rxW;
    dockRight = Math.min(dockRight, maxDockRight);
    let dockLeft = dockRight - rxW;
    if (dockLeft < minDockLeft) {
      dockLeft = minDockLeft;
      dockRight = Math.min(dockLeft + rxW, maxDockRight);
    }

    if (dockRight - dockLeft >= 16) {
      // Straight to dock start
      pathParts.push(`L ${f(dockRight)} ${f(y1)}`);

      // Concave curve dipping down into reaction dock
      const filletR = 5;
      const dockBottomY = y1 + rxH;
      const dockCornerR = 8;

      pathParts.push(`C ${f(dockRight - filletR * 0.5)} ${f(y1)}, ${f(dockRight - filletR)} ${f(y1 + filletR * 0.5)}, ${f(dockRight - filletR)} ${f(y1 + filletR)}`);
      pathParts.push(`L ${f(dockRight - filletR)} ${f(dockBottomY - dockCornerR)}`);
      pathParts.push(`C ${f(dockRight - filletR)} ${f(dockBottomY)}, ${f(dockRight - filletR - dockCornerR * 0.55)} ${f(dockBottomY)}, ${f(dockRight - filletR - dockCornerR)} ${f(dockBottomY)}`);
      pathParts.push(`L ${f(dockLeft + filletR + dockCornerR)} ${f(dockBottomY)}`);
      pathParts.push(`C ${f(dockLeft + filletR + dockCornerR * 0.55)} ${f(dockBottomY)}, ${f(dockLeft + filletR)} ${f(dockBottomY)}, ${f(dockLeft + filletR)} ${f(dockBottomY - dockCornerR)}`);
      pathParts.push(`L ${f(dockLeft + filletR)} ${f(y1 + filletR)}`);
      pathParts.push(`C ${f(dockLeft + filletR)} ${f(y1 + filletR * 0.5)}, ${f(dockLeft + filletR * 0.5)} ${f(y1)}, ${f(dockLeft)} ${f(y1)}`);
    }
  }

  // Straight to bottom-left corner start
  pathParts.push(`L ${f(x0 + (hasTail && side === 'in' ? 0 : lbl))} ${f(y1)}`);

  // 6. Bottom-Left corner or Incoming Tail
  if (hasTail && side === 'in') {
    // Incoming with continuous Bezier tail at bottom-left
    const tipX = tailPlacement === 'inside'
      ? 0 - swipeOffset * 0.35
      : x0 - tailWidth - swipeOffset * 0.35;
    const tipY = y1 + (state.isPending && !isReducedMotion ? -1.5 : 0);
    const baseReturnX = x0 + Math.max(3, lbl * 0.65);

    // Return curve from baseline outward to tail tip
    const cpIn1X = baseReturnX - 2;
    const cpIn1Y = y1;
    const cpIn2X = tipX + (baseReturnX - tipX) * 0.45;
    const cpIn2Y = tipY;
    pathParts.push(`C ${f(cpIn1X)} ${f(cpIn1Y)}, ${f(cpIn2X)} ${f(cpIn2Y)}, ${f(tipX)} ${f(tipY)}`);

    // Curve from tip up along left edge
    const tailStartY = Math.max(y0 + ltl, y1 - tailHeight);
    const cpOut1X = x0 - (x0 - tipX) * 0.65;
    const cpOut1Y = tipY - 0.8;
    const cpOut2X = x0 - (x0 - tipX) * 0.22;
    const cpOut2Y = tailStartY + (tipY - tailStartY) * 0.55;
    pathParts.push(`C ${f(cpOut1X)} ${f(cpOut1Y)}, ${f(cpOut2X)} ${f(cpOut2Y)}, ${f(x0)} ${f(tailStartY)}`);
  } else {
    // Bottom-Left squircle corner
    if (lbl > 0.5) {
      const cp1x = x0 + lbl - lbl * kappa;
      const cp1y = y1;
      const cp2x = x0;
      const cp2y = y1 - lbl + lbl * kappa;
      pathParts.push(`C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(x0)} ${f(y1 - lbl)}`);
    } else {
      pathParts.push(`L ${f(x0)} ${f(y1)}`);
    }
  }

  // 7. Left edge upwards to top-left corner start
  pathParts.push(`L ${f(x0)} ${f(y0 + ltl)}`);

  // 8. Top-Left squircle corner
  if (ltl > 0.5) {
    const cp1x = x0;
    const cp1y = y0 + ltl - ltl * kappa;
    const cp2x = x0 + ltl - ltl * kappa;
    const cp2y = y0;
    pathParts.push(`C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(x0 + ltl)} ${f(y0)}`);
  } else {
    pathParts.push(`L ${f(x0)} ${f(y0)}`);
  }

  // 9. Close path
  pathParts.push('Z');

  const finalPath = pathParts.join(' ');

  // Evict earliest entry if cache reaches limit
  if (pathCache.size >= PATH_CACHE_LIMIT) {
    const firstKey = pathCache.keys().next().value;
    if (firstKey !== undefined) {
      pathCache.delete(firstKey);
    }
  }
  pathCache.set(cacheKey, finalPath);

  return finalPath;
}

/**
 * Computes a unified group path for a dense cluster of consecutive bubbles.
 * Blends adjacent bubble contours into an unbroken vertical column without seams.
 */
export function computeSeriesMergedPath(
  items: Array<{
    width: number;
    height: number;
    offsetTop: number;
    side: BubbleSide;
    hasTail?: boolean;
  }>,
  options?: {
    tension?: number;
    tailWidth?: number;
  }
): string {
  if (!items || items.length === 0) return '';
  if (items.length === 1) {
    const single = items[0];
    return computeBubblePath({
      width: single.width,
      height: single.height,
      side: single.side,
      seriesPosition: 'single',
      tail: Boolean(single.hasTail),
      params: options
    });
  }

  // For multi-item dense clusters, construct continuous outer silhouette
  const side = items[0].side;
  const tension = options?.tension ?? DEFAULT_TENSION;
  const kappa = 0.5523 + 0.16 * tension;
  const baseR = DEFAULT_BASE_RADIUS;

  const pathParts: string[] = [];
  const first = items[0];
  const last = items[items.length - 1];
  const totalH = last.offsetTop + last.height;

  // First bubble top
  const ltl = Math.min(baseR * (1 + 0.22 * tension), first.width / 2);
  const ltr = Math.min(baseR * (1 + 0.22 * tension), first.width / 2);

  pathParts.push(`M ${f(ltl)} 0`);
  pathParts.push(`L ${f(first.width - ltr)} 0`);
  pathParts.push(`C ${f(first.width - ltr + ltr * kappa)} 0, ${f(first.width)} ${f(ltr - ltr * kappa)}, ${f(first.width)} ${f(ltr)}`);

  // Traverse down right edge through all items
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nextItem = items[i + 1];
    const itemBottom = item.offsetTop + item.height;

    if (nextItem) {
      if (item.width === nextItem.width) {
        pathParts.push(`L ${f(item.width)} ${f(itemBottom)}`);
      } else if (item.width > nextItem.width) {
        // Step inward with smooth fillet
        const fillet = 4;
        pathParts.push(`L ${f(item.width)} ${f(itemBottom - fillet)}`);
        pathParts.push(`C ${f(item.width)} ${f(itemBottom)}, ${f(nextItem.width + fillet)} ${f(itemBottom)}, ${f(nextItem.width)} ${f(itemBottom + fillet)}`);
      } else {
        // Step outward with smooth fillet
        const fillet = 4;
        pathParts.push(`L ${f(item.width)} ${f(itemBottom - fillet)}`);
        pathParts.push(`C ${f(item.width)} ${f(itemBottom)}, ${f(nextItem.width - fillet)} ${f(itemBottom)}, ${f(nextItem.width)} ${f(itemBottom + fillet)}`);
      }
    } else {
      // Last item bottom-right
      if (item.hasTail && side === 'out') {
        const tailH = DEFAULT_TAIL_HEIGHT;
        const tailW = options?.tailWidth ?? DEFAULT_TAIL_WIDTH;
        pathParts.push(`L ${f(item.width)} ${f(totalH - tailH)}`);
        pathParts.push(`C ${f(item.width + tailW * 0.22)} ${f(totalH - tailH * 0.45)}, ${f(item.width + tailW * 0.65)} ${f(totalH - 0.8)}, ${f(item.width + tailW)} ${f(totalH)}`);
        pathParts.push(`C ${f(item.width + tailW * 0.55)} ${f(totalH)}, ${f(item.width - 2)} ${f(totalH)}, ${f(item.width - 4)} ${f(totalH)}`);
      } else {
        const lbr = Math.min(baseR * (1 + 0.22 * tension), item.width / 2);
        pathParts.push(`L ${f(item.width)} ${f(totalH - lbr)}`);
        pathParts.push(`C ${f(item.width)} ${f(totalH - lbr + lbr * kappa)}, ${f(item.width - lbr + lbr * kappa)} ${f(totalH)}, ${f(item.width - lbr)} ${f(totalH)}`);
      }
    }
  }

  // Last item bottom-left
  const lbl = Math.min(baseR * (1 + 0.22 * tension), last.width / 2);
  if (last.hasTail && side === 'in') {
    const tailW = options?.tailWidth ?? DEFAULT_TAIL_WIDTH;
    const tailH = DEFAULT_TAIL_HEIGHT;
    pathParts.push(`L ${f(4)} ${f(totalH)}`);
    pathParts.push(`C ${f(2)} ${f(totalH)}, ${f(-tailW * 0.55)} ${f(totalH)}, ${f(-tailW)} ${f(totalH)}`);
    pathParts.push(`C ${f(-tailW * 0.65)} ${f(totalH - 0.8)}, ${f(-tailW * 0.22)} ${f(totalH - tailH * 0.45)}, 0 ${f(totalH - tailH)}`);
  } else {
    pathParts.push(`L ${f(lbl)} ${f(totalH)}`);
    pathParts.push(`C ${f(lbl - lbl * kappa)} ${f(totalH)}, 0 ${f(totalH - lbl + lbl * kappa)}, 0 ${f(totalH - lbl)}`);
  }

  // Traverse up left edge to start
  pathParts.push(`L 0 ${f(ltl)}`);
  pathParts.push(`C 0 ${f(ltl - ltl * kappa)}, ${f(ltl - ltl * kappa)} 0, ${f(ltl)} 0`);
  pathParts.push('Z');

  return pathParts.join(' ');
}
