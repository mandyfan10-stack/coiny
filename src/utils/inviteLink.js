/**
 * Invite link utilities: build, parse, clean, and persist pending invites.
 */

const PENDING_INVITE_STORAGE_KEY = 'coiny_pending_invite';

/**
 * Returns the base web URL of the application.
 * Adapts dynamically to localhost, GitHub Pages, or custom domains.
 * Falls back to canonical production URL when running in Electron/Capacitor file:// or custom schemes.
 */
export function getAppBaseUrl() {
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol;
    if (protocol === 'http:' || protocol === 'https:') {
      const pathname = window.location.pathname
        .replace(/\/index\.html$/i, '')
        .replace(/\/+$/, '');
      return `${window.location.origin}${pathname}`;
    }
  }
  return 'https://mandyfan10-stack.github.io/coingram-chat';
}

/**
 * Strips leading @, trims whitespace, and decodes URI components.
 */
export function cleanInviteIdentifier(raw) {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(String(raw)).trim();
    const stripped = decoded.replace(/^@+/, '').trim();
    return stripped.length > 0 ? stripped : null;
  } catch {
    const stripped = String(raw).trim().replace(/^@+/, '').trim();
    return stripped.length > 0 ? stripped : null;
  }
}

/**
 * Builds a clean, fully-qualified invite link for a given username or chat ID.
 */
export function buildInviteLink(identifier) {
  const clean = cleanInviteIdentifier(identifier);
  if (!clean) return '';
  const base = getAppBaseUrl();
  const sep = base.includes('?') ? '&' : '/?';
  return `${base.replace(/\/+$/, '')}${sep}invite=${encodeURIComponent(clean)}`;
}

/**
 * Parses invite identifier from URL search params or hash.
 * Supports:
 * - ?invite=username
 * - ?start=username
 * - #invite=username
 * - #/invite/username
 * - #start=username
 */
export function parseInviteParam(loc = typeof window !== 'undefined' ? window.location : null) {
  if (!loc) return null;
  try {
    // 1. Search params
    if (loc.search) {
      const searchParams = new URLSearchParams(loc.search);
      const val = searchParams.get('invite') || searchParams.get('start');
      const clean = cleanInviteIdentifier(val);
      if (clean) return clean;
    }

    // 2. Hash params or route
    if (loc.hash) {
      const hashStr = loc.hash.replace(/^#\/?/, '');
      if (hashStr.includes('?') || hashStr.includes('=')) {
        const queryPart = hashStr.includes('?') ? hashStr.split('?')[1] : hashStr;
        const hashParams = new URLSearchParams(queryPart);
        const val = hashParams.get('invite') || hashParams.get('start');
        const clean = cleanInviteIdentifier(val);
        if (clean) return clean;
      }
      const match = hashStr.match(/^(?:invite|start)\/([^/?#]+)/i);
      if (match && match[1]) {
        const clean = cleanInviteIdentifier(match[1]);
        if (clean) return clean;
      }
    }
  } catch (err) {
    console.warn('Failed to parse invite parameter:', err);
  }
  return null;
}

/**
 * Clears invite and start parameters from the current browser address bar without page reload.
 */
export function clearInviteParamFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const current = window.location;
    let hasChanges = false;

    const url = new URL(current.href);
    if (url.searchParams.has('invite')) {
      url.searchParams.delete('invite');
      hasChanges = true;
    }
    if (url.searchParams.has('start')) {
      url.searchParams.delete('start');
      hasChanges = true;
    }

    if (url.hash && (url.hash.includes('invite=') || url.hash.includes('start=') || url.hash.startsWith('#/invite/') || url.hash.startsWith('#invite/'))) {
      url.hash = '';
      hasChanges = true;
    }

    if (hasChanges) {
      const searchStr = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
      const newUrl = `${url.pathname}${searchStr}${url.hash}` || '/';
      window.history.replaceState(window.history.state, '', newUrl);
    }
  } catch (err) {
    console.warn('Failed to clear invite parameter from URL:', err);
  }
}

/**
 * Saves a pending invite into sessionStorage so it survives login/registration redirection.
 */
export function savePendingInvite(identifier) {
  const clean = cleanInviteIdentifier(identifier);
  if (!clean || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, clean);
  } catch {
    // Ignore storage quota/security restrictions
  }
}

/**
 * Retrieves the pending invite from sessionStorage.
 */
export function getPendingInvite() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    return cleanInviteIdentifier(stored);
  } catch {
    return null;
  }
}

/**
 * Clears the pending invite from sessionStorage.
 */
export function clearPendingInvite() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
