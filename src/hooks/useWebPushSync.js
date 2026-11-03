// @ts-check
import { useEffect } from 'react';
import { webPushService } from '../services/webPushService.ts';

/** @param {{ id: string, notificationsEnabled?: boolean } | null} currentUser */
export function useWebPushSync(currentUser) {
  const userId = currentUser?.id;
  const enabled = currentUser?.notificationsEnabled !== false;
  useEffect(() => {
    if (!userId || !webPushService.configured) return undefined;
    const sync = () => {
      if (document.hidden) return;
      void webPushService.sync(userId, enabled).catch(() => console.warn('Background notifications could not be synchronized.'));
    };
    sync();
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync); };
  }, [userId, enabled]);
}
