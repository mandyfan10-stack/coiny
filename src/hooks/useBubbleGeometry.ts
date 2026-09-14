/**
 * useBubbleGeometry.ts
 *
 * React hook managing parametric squircle geometry calculation,
 * ResizeObserver layout measurement without layout thrashing,
 * feature detection, and dynamic state warps for message bubbles.
 */

import React, { useState, useEffect, useLayoutEffect, useId } from 'react';
import {
  computeBubblePath,
  type BubbleSide,
  type SeriesPosition
} from '../utils/bubbleGeometry';
import {
  getBubbleGeometryStrategy,
  type BubbleGeometryStrategy
} from '../utils/bubbleGeometrySupport';

export interface UseBubbleGeometryOptions {
  side: BubbleSide;
  seriesPosition: SeriesPosition;
  hasTail: boolean;
  isHovered?: boolean;
  isPressed?: boolean;
  swipeOffset?: number;
  isPending?: boolean;
  hasReactions?: boolean;
  reactionsCount?: number;
  denseNext?: boolean;
  densePrev?: boolean;
  disabled?: boolean;
}

export interface UseBubbleGeometryReturn {
  strategy: BubbleGeometryStrategy;
  isCustomActive: boolean;
  bubblePath: string;
  bubbleStyle: React.CSSProperties;
  svgClipElement: React.ReactNode | null;
}

export default function useBubbleGeometry(
  bubbleRef: React.RefObject<HTMLDivElement | null>,
  options: UseBubbleGeometryOptions
): UseBubbleGeometryReturn {
  const [strategy, setStrategy] = useState<BubbleGeometryStrategy>(() => getBubbleGeometryStrategy());
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const rawClipId = useId();
  const clipId = `bubble-clip-${rawClipId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Listen for user preference changes and reduced motion preferences
  useEffect(() => {
    const handlePrefChange = () => {
      setStrategy(getBubbleGeometryStrategy());
    };

    window.addEventListener('coiny-bubble-geometry-change', handlePrefChange);

    let motionQuery: MediaQueryList | null = null;
    const handleMotionChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };

    if (typeof window !== 'undefined' && window.matchMedia) {
      motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      motionQuery.addEventListener('change', handleMotionChange);
    }

    return () => {
      window.removeEventListener('coiny-bubble-geometry-change', handlePrefChange);
      if (motionQuery) {
        motionQuery.removeEventListener('change', handleMotionChange);
      }
    };
  }, []);

  // Synchronous first-pass measurement to prevent visual jumps before paint
  useLayoutEffect(() => {
    if (!bubbleRef.current) return;
    const el = bubbleRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0) {
      setSize((prev) => {
        if (prev.width === w && prev.height === h) return prev;
        return { width: w, height: h };
      });
    }
  }, [bubbleRef, options.hasReactions, options.reactionsCount]);

  // Single-pass ResizeObserver: only fires when dimensions truly change, NOT on scroll
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    let rafId: number | null = null;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        let w = 0;
        let h = 0;
        if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
          w = entry.borderBoxSize[0].inlineSize;
          h = entry.borderBoxSize[0].blockSize;
        } else {
          w = (entry.target as HTMLElement).offsetWidth;
          h = (entry.target as HTMLElement).offsetHeight;
        }

        if (w > 0 && h > 0) {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            setSize((prev) => {
              if (Math.abs(prev.width - w) < 0.5 && Math.abs(prev.height - h) < 0.5) {
                return prev;
              }
              return { width: Math.round(w), height: Math.round(h) };
            });
          });
        }
      }
    });

    observer.observe(el);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [bubbleRef]);

  const isCustomActive = !options.disabled && strategy !== 'fallback-border-radius' && size.width > 0 && size.height > 0;

  // Compute parametric path using memoized pure generator
  let bubblePath = '';
  if (isCustomActive) {
    const rxCount = options.reactionsCount ?? (options.hasReactions ? 1 : 0);
    const approxReactionsW = rxCount > 0 ? Math.min(size.width - 24, rxCount * 42 + 10) : 0;

    bubblePath = computeBubblePath({
      width: size.width,
      height: size.height,
      side: options.side,
      seriesPosition: options.seriesPosition,
      tail: options.hasTail,
      params: {
        tailPlacement: 'inside',
        denseNext: options.denseNext,
        densePrev: options.densePrev,
        cutout: rxCount > 0 ? {
          reactions: {
            width: approxReactionsW,
            height: 24,
            offset: 14
          }
        } : undefined,
        state: {
          isHovered: options.isHovered,
          isPressed: options.isPressed,
          swipeOffset: options.swipeOffset,
          isPending: options.isPending,
          reducedMotion
        }
      }
    });
  }

  // Construct styling based on detected platform strategy
  const bubbleStyle: React.CSSProperties = {};
  let svgClipElement: React.ReactNode | null = null;

  if (isCustomActive && bubblePath) {
    if (strategy === 'clip-path-path') {
      bubbleStyle.clipPath = `path("${bubblePath}")`;
      (bubbleStyle as Record<string, string>)['-webkit-clip-path'] = `path("${bubblePath}")`;
    } else if (strategy === 'svg-mask') {
      bubbleStyle.clipPath = `url(#${clipId})`;
      (bubbleStyle as Record<string, string>)['-webkit-clip-path'] = `url(#${clipId})`;

      // Render SVG clipPath element into DOM using React.createElement for pure .ts compatibility
      svgClipElement = React.createElement(
        'svg',
        {
          key: clipId,
          style: { position: 'absolute', width: 0, height: 0, pointerEvents: 'none' },
          'aria-hidden': 'true'
        },
        React.createElement(
          'defs',
          null,
          React.createElement(
            'clipPath',
            { id: clipId, clipPathUnits: 'userSpaceOnUse' },
            React.createElement('path', { d: bubblePath })
          )
        )
      );
    }
  }

  return {
    strategy,
    isCustomActive,
    bubblePath,
    bubbleStyle,
    svgClipElement
  };
}
