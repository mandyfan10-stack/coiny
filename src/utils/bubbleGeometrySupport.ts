/**
 * bubbleGeometrySupport.ts
 *
 * Feature detection, platform strategy selection, and user preferences
 * for runtime parametric bubble geometry in Coiny.
 *
 * Strategies:
 * 1. 'clip-path-path': Hardware accelerated CSS clip-path: path(...) (Web, Electron 43, modern Android WebView).
 * 2. 'svg-mask': Inline SVG mask/clipPath fallback for environments lacking CSS path() parsing.
 * 3. 'fallback-border-radius': Classic static CSS border-radius and SVG background tails.
 */

export type BubbleGeometryStrategy = 'clip-path-path' | 'svg-mask' | 'fallback-border-radius';

const STORAGE_KEY = 'coiny_custom_bubble_geometry';
let cachedStrategy: BubbleGeometryStrategy | null = null;

/**
 * Resets cached strategy for unit testing or live preference reloads.
 */
export function resetBubbleGeometrySupportCache(): void {
  cachedStrategy = null;
}

/**
 * Checks whether custom bubble geometry is enabled via user setting or env flag.
 * Default is enabled (true) unless explicitly toggled off.
 */
export function isCustomBubbleGeometryEnabled(): boolean {
  if (typeof window === 'undefined') return true;

  // 1. Check local storage user preference
  try {
    const localSetting = window.localStorage?.getItem(STORAGE_KEY);
    if (localSetting !== null) {
      return localSetting !== 'false';
    }
  } catch {
    // LocalStorage inaccessible (e.g. sandbox/private window)
  }

  // 2. Check Vite environment variable
  try {
    const envVal = import.meta.env.VITE_CUSTOM_BUBBLE_GEOMETRY;
    if (envVal !== undefined && (envVal === 'false' || envVal === false)) {
      return false;
    }
  } catch {
    // In environments where import.meta.env is not defined
  }

  return true;
}

/**
 * Sets user preference for custom bubble geometry and persists to localStorage.
 */
export function setCustomBubbleGeometryEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    resetBubbleGeometrySupportCache();
    // Dispatch custom event so listeners can re-render immediately without reload
    window.dispatchEvent(new CustomEvent('coiny-bubble-geometry-change', { detail: { enabled } }));
  } catch {
    // Ignore storage write errors
  }
}

/**
 * One-time feature detection selecting the optimal strategy.
 */
export function detectBubbleGeometryStrategy(): BubbleGeometryStrategy {
  if (cachedStrategy !== null) {
    return cachedStrategy;
  }

  // If disabled by preference, use classic fallback directly
  if (!isCustomBubbleGeometryEnabled()) {
    cachedStrategy = 'fallback-border-radius';
    return cachedStrategy;
  }

  // Server-side rendering or non-browser fallback
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cachedStrategy = 'clip-path-path';
    return cachedStrategy;
  }

  // 1. Test clip-path: path(...) via CSS.supports
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      const testSample = 'path("M 0 0 L 10 10 Z")';
      const supportsStandard = CSS.supports('clip-path', testSample);
      const supportsWebkit = CSS.supports('-webkit-clip-path', testSample);

      if (supportsStandard || supportsWebkit) {
        cachedStrategy = 'clip-path-path';
        return cachedStrategy;
      }
    }
  } catch {
    // CSS.supports invocation failed
  }

  // 2. Test SVG clipPath / mask support
  try {
    if (typeof document.createElementNS === 'function') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      if (svg && clipPath) {
        cachedStrategy = 'svg-mask';
        return cachedStrategy;
      }
    }
  } catch {
    // SVG createElementNS failed
  }

  // 3. Fallback to classic CSS border-radius
  cachedStrategy = 'fallback-border-radius';
  return cachedStrategy;
}

/**
 * Public accessor for current strategy.
 */
export function getBubbleGeometryStrategy(): BubbleGeometryStrategy {
  return detectBubbleGeometryStrategy();
}

/**
 * Helper to check if any custom geometry (path or SVG mask) is active.
 */
export function isCustomBubbleGeometryActive(): boolean {
  return getBubbleGeometryStrategy() !== 'fallback-border-radius';
}
