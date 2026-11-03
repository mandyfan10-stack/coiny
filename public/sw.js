// Notifications carry only identifiers. Chat access is checked again by the app.
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;

function notificationTarget(value) {
  if (!value || typeof value !== 'object'
    || typeof value.chatId !== 'string' || !identifier.test(value.chatId)
    || typeof value.ownerId !== 'string' || !identifier.test(value.ownerId)) return null;
  return { chatId: value.chatId, ownerId: value.ownerId };
}

function belongsToRecipient(client, target) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = accepted => { clearTimeout(timer); channel.port1.close(); resolve(accepted); };
    const timer = setTimeout(() => finish(false), 750);
    channel.port1.onmessage = event => finish(event.data?.accepted === true);
    try { client.postMessage({ type: 'coiny:notification-probe', target }, [channel.port2]); }
    catch { finish(false); }
  });
}

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', event => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data.json(); } catch { payload = {}; }
    const target = notificationTarget(payload?.data);
    const base = new URL(self.registration.scope);
    await self.registration.showNotification('Coiny', {
      // Never put message plaintext or ciphertext into background notifications.
      body: 'Новое сообщение',
      icon: new URL('favicon.svg', base).href,
      badge: new URL('favicon.svg', base).href,
      tag: target ? `coiny:${target.ownerId}:${target.chatId}` : 'coiny-message',
      data: target
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = notificationTarget(event.notification.data);
    const scope = new URL(self.registration.scope);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const candidates = windows.filter(candidate => {
      const url = new URL(candidate.url);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    });
    const matches = target ? await Promise.all(candidates.map(candidate => belongsToRecipient(candidate, target))) : [];
    const client = target ? candidates[matches.findIndex(Boolean)] : candidates[0];
    if (client) {
      // Do not reload an active call or discard a composed message.
      if (target) client.postMessage({ type: 'coiny:open-chat', target });
      await client.focus();
      return;
    }
    if (target) {
      scope.searchParams.set('notificationChat', target.chatId);
      scope.searchParams.set('notificationOwner', target.ownerId);
    }
    await self.clients.openWindow(scope.href);
  })());
});
