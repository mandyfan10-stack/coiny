import { supabase } from '../supabaseClient.js';
import { initNotificationService, waitForNotificationRegistration } from './notificationService.js';

interface PushClient {
  rpc(name: string, args: Record<string, string>): PromiseLike<{ error: unknown }>;
}
interface PushStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const OWNER_KEY = 'coingram-push-owner';

export function decodePushPublicKey(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]{87}$/.test(value)) throw new Error('Invalid Web Push public key.');
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const key = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (key.length !== 65 || key[0] !== 4) throw new Error('Invalid Web Push public key.');
  return key.buffer;
}

export function createWebPushService({ client, publicKey, registration, storage, permission, timeoutMs = 5000 }: {
  client: PushClient | null;
  publicKey: string;
  registration: () => Promise<ServiceWorkerRegistration | null>;
  storage: () => PushStorage | undefined;
  permission: () => NotificationPermission;
  timeoutMs?: number;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  const bounded = <T>(operation: PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Не удалось настроить фоновые уведомления. Проверьте соединение и повторите попытку.')), timeoutMs);
    Promise.resolve(operation).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(operation);
    queue = next;
    return next;
  };
  const disable = async (worker: ServiceWorkerRegistration): Promise<void> => {
    const subscription = await bounded(worker.pushManager.getSubscription());
    if (!subscription) { storage()?.removeItem(OWNER_KEY); return; }
    // Either removing the row or invalidating the provider endpoint stops delivery.
    // Attempt both even when the account token has already expired.
    const results = await Promise.allSettled([
      (async () => {
        if (!client) throw new Error('No authenticated push client.');
        const { error } = await bounded(client.rpc('remove_web_push_subscription', { p_endpoint: subscription.endpoint }));
        if (error) throw error;
      })(),
      bounded(subscription.unsubscribe()).then(removed => { if (!removed) throw new Error('Push subscription is still active.'); })
    ]);
    if (results.every(result => result.status === 'rejected')) throw new Error('Не удалось отключить фоновые уведомления. Повторите попытку.');
    storage()?.removeItem(OWNER_KEY);
  };

  return {
    configured: Boolean(client && publicKey),
    sync(userId: string | undefined, enabled: boolean): Promise<void> {
      return serialize(async () => {
        if (!client || !publicKey || !userId) return;
        const worker = await bounded(registration());
        if (!worker?.pushManager) {
          if (enabled) throw new Error('Этот браузер не поддерживает фоновые уведомления.');
          return;
        }
        if (!enabled || permission() !== 'granted') { await disable(worker); return; }
        const key = decodePushPublicKey(publicKey);
        let subscription = await bounded(worker.pushManager.getSubscription());
        // An endpoint must never be reused across accounts or VAPID key rotations.
        const existingKey = subscription?.options.applicationServerKey;
        const sameKey = existingKey && new Uint8Array(existingKey).toString() === new Uint8Array(key).toString();
        if (subscription && (storage()?.getItem(OWNER_KEY) !== userId || !sameKey)) {
          await disable(worker);
          subscription = null;
        }
        subscription ??= await bounded(worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        const keys = subscription.toJSON().keys;
        if (!keys?.p256dh || !keys.auth) throw new Error('Браузер не предоставил ключи уведомлений.');
        const { error } = await bounded(client.rpc('register_web_push_subscription', {
          p_endpoint: subscription.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth
        }));
        if (error) throw new Error('Не удалось подключить фоновые уведомления. Повторите попытку.');
        storage()?.setItem(OWNER_KEY, userId);
      });
    },
    disable(): Promise<void> {
      return serialize(async () => {
        if ((!client || !publicKey) && !storage()?.getItem(OWNER_KEY)) return;
        const worker = await bounded(registration());
        if (worker?.pushManager) await disable(worker);
      });
    }
  };
}

export const webPushService = createWebPushService({
  client: supabase,
  publicKey: typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator
    ? import.meta.env?.VITE_WEB_PUSH_PUBLIC_KEY || '' : '',
  registration: async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in globalThis)) return null;
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 4000);
      void initNotificationService().then(async worker => worker ? waitForNotificationRegistration(navigator.serviceWorker) : null)
        .then(worker => { clearTimeout(timer); resolve(worker || null); }, () => { clearTimeout(timer); resolve(null); });
    });
  },
  storage: () => globalThis.localStorage,
  permission: () => typeof Notification === 'undefined' ? 'denied' : Notification.permission
});
