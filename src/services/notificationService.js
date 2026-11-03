// @ts-check
export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'denied';
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.warn('Failed to request notification permission:', err);
    return 'denied';
  }
}

/**
 * Initializes Service Worker registration on startup for Android & Web Push Notifications.
 */
export async function initNotificationService() {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return;

  if ('serviceWorker' in navigator) {
    try {
      const swPath = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
        ? `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/sw.js`
        : './sw.js';
      await navigator.serviceWorker.register(swPath).catch(() => {});
    } catch {
      /* ignore service worker errors in restricted environments */
    }
  }
}

/**
 * Dispatches an OS/browser push notification if the window is in the background or hidden.
 * Works across Android Chrome, PWA, Mobile, and Desktop browsers.
 *
 * @param {Object} options
 * @param {string} options.title - Notification title (e.g. sender name)
 * @param {string} options.body - Message preview text or call status
 * @param {string} [options.icon] - Icon or avatar URL
 * @param {string} [options.tag] - Grouping tag (e.g. chatId)
 * @param {any} [options.data] - Arbitrary payload
 * @param {(() => void) | null} [options.onClick] - Click handler (brings chat into focus)
 */
export async function showIncomingNotification({
  title,
  body,
  icon = '/favicon.svg',
  tag = 'coingram-notification',
  data = null,
  onClick = null
}) {
  if (!isNotificationSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    // Only display notification when the tab is hidden or not actively focused
    const isTabActive = typeof document !== 'undefined' && !document.hidden && (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
    if (isTabActive) return null;

    const notifOptions = {
      body: body || 'Новое сообщение',
      icon: icon || '/favicon.svg',
      badge: '/favicon.svg',
      tag,
      data,
      silent: false
    };

    // Tier 1: ServiceWorkerRegistration (Required on Android / Chrome Mobile / PWA)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && typeof registration.showNotification === 'function') {
          await registration.showNotification(title || 'Coiny', notifOptions);
          return registration;
        }
      } catch {
        /* fallback to standard Notification */
      }
    }

    // Tier 2: Desktop Web Standard Notification API
    try {
      const notification = new Notification(title || 'Coiny', notifOptions);
      notification.onclick = (event) => {
        event.preventDefault();
        try {
          if (typeof window !== 'undefined') {
            window.focus();
          }
        } catch {
          /* ignore focus errors */
        }
        if (typeof onClick === 'function') {
          onClick();
        }
        notification.close();
      };
      return notification;
    } catch {
      /* standard constructor not supported on mobile */
    }
  } catch (err) {
    console.warn('Could not display push notification:', err);
  }
  return null;
}

export default {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  initNotificationService,
  showIncomingNotification
};

