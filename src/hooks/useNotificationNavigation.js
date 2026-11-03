// @ts-check
import { useEffect, useRef, useState } from 'react';
import { canOpenNotificationTarget, notificationTargetFromUrl, parseNotificationTarget, withoutNotificationTarget } from '../utils/notificationTarget.ts';

/**
 * Wait for authentication and the chat list on a cold notification launch.
 * @param {{ currentUser: { id: string } | null, chats: Array<{ id: string }>, setActiveChatId: (id: string) => void }} options
 */
export function useNotificationNavigation({ currentUser, chats, setActiveChatId }) {
  const [pending, setPending] = useState(() => notificationTargetFromUrl(window.location.href));
  const userIdRef = useRef(currentUser?.id);
  userIdRef.current = currentUser?.id;

  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return undefined;
    /** @param {MessageEvent} event */
    const onMessage = event => {
      if (!['coiny:open-chat', 'coiny:notification-probe'].includes(event.data?.type)) return;
      const target = parseNotificationTarget(event.data.target);
      if (event.data.type === 'coiny:notification-probe') {
        event.ports?.[0]?.postMessage({ accepted: Boolean(target && target.ownerId === userIdRef.current) });
        return;
      }
      if (target) setPending(target);
    };
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!pending || !currentUser?.id) return;
    if (pending.ownerId === currentUser.id && !canOpenNotificationTarget(pending, currentUser.id, chats)) return;
    if (canOpenNotificationTarget(pending, currentUser.id, chats)) setActiveChatId(pending.chatId);
    // Discard another account's target rather than retaining it across sign-ins.
    setPending(null);
    const url = withoutNotificationTarget(window.location.href);
    window.history.replaceState(window.history.state, '', url);
  }, [pending, currentUser?.id, chats, setActiveChatId]);
}
