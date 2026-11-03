import { clearOfflineDatabase } from './indexedDbHelper.js';
import { revokeAllManagedObjectUrls } from './objectUrlRegistry.js';
import { webPushService } from '../services/webPushService.ts';

const APP_STORAGE_PREFIXES = ['coingram-', 'tg-'];
let activeCleanup = null;

function removeAppStorage(storage) {
  if (!storage) return;
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
}

/** Remove only Coiny-owned local state and leave unrelated origin data intact. */
export async function clearLocalAppData() {
  if (activeCleanup) return activeCleanup;

  activeCleanup = (async () => {
    await webPushService.disable().catch(() => {});
    revokeAllManagedObjectUrls();
    removeAppStorage(globalThis.localStorage);
    removeAppStorage(globalThis.sessionStorage);
    await clearOfflineDatabase();
  })();

  try {
    await activeCleanup;
  } finally {
    activeCleanup = null;
  }
}
