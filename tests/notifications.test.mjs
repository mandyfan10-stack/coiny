import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { showIncomingNotification, waitForNotificationRegistration } from '../src/services/notificationService.js';
import { canOpenNotificationTarget, parseNotificationTarget, notificationTargetFromUrl, withoutNotificationTarget } from '../src/utils/notificationTarget.ts';

const target = { ownerId: 'alice', chatId: 'group-1' };

function browser(t, ready) {
  const notifications = [];
  class Notification {
    static permission = 'granted';
    constructor(title, options) { this.title = title; this.options = options; notifications.push(this); }
    close() { this.closed = true; }
  }
  for (const [key, value] of Object.entries({
    Notification, window: { Notification, focus() {} }, document: { hidden: true },
    navigator: { serviceWorker: { ready } }
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  return notifications;
}

test('worker readiness is bounded and rejected registration is handled', async () => {
  assert.equal(await waitForNotificationRegistration({ ready: new Promise(() => {}) }, 5), null);
  assert.equal(await waitForNotificationRegistration({ ready: Promise.reject(new Error('registration failed')) }), null);
});

test('failed worker registration falls back to a desktop notification and preserves clicks', async t => {
  const notifications = browser(t, Promise.reject(new Error('unsupported origin')));
  let clicked = false;
  const result = await showIncomingNotification({ title: 'Alice', body: 'Hello', data: target, onClick: () => { clicked = true; } });
  assert.equal(result, notifications[0]);
  result.onclick({ preventDefault() {} });
  assert.equal(clicked, true);
  assert.equal(result.closed, true);
});

test('an unresolved ready promise reaches the desktop fallback', async t => {
  const notifications = browser(t, new Promise(() => {}));
  await showIncomingNotification({ title: 'Alice', data: target });
  assert.equal(notifications.length, 1);
});

test('service-worker notifications receive serializable, account-bound chat targets', async t => {
  const shown = [];
  const registration = { showNotification: async (title, options) => shown.push({ title, options }) };
  const notifications = browser(t, Promise.resolve(registration));
  await showIncomingNotification({ title: 'Alice', data: { ...target, messageId: 'message-1', url: 'https://attacker.example' }, onClick() {} });
  assert.equal(notifications.length, 0);
  assert.deepEqual(shown[0].options.data, { ...target, messageId: 'message-1' });
});

test('foreground tabs and denied notification permissions stay silent', async t => {
  const notifications = browser(t, Promise.resolve(null));
  document.hidden = false;
  await showIncomingNotification({ title: 'Alice' });
  document.hidden = true;
  Notification.permission = 'denied';
  await showIncomingNotification({ title: 'Alice' });
  assert.equal(notifications.length, 0);
});

test('notification navigation requires the recipient account and an existing chat', () => {
  assert.equal(canOpenNotificationTarget(target, 'bob', [{ id: target.chatId }]), false);
  assert.equal(canOpenNotificationTarget(target, 'alice', []), false);
  assert.equal(canOpenNotificationTarget(target, 'alice', [{ id: target.chatId }]), true);
  for (const data of [null, {}, { chatId: '../admin', ownerId: 'alice' }, { chatId: 'group-1', ownerId: '' }]) {
    assert.equal(parseNotificationTarget(data), null);
  }
  const url = 'https://example.com/coiny/?invite=keep&notificationChat=group-1&notificationOwner=alice#keep';
  assert.deepEqual(notificationTargetFromUrl(url), target);
  assert.equal(withoutNotificationTarget(url), 'https://example.com/coiny/?invite=keep#keep');
});

function worker(clients = []) {
  const handlers = new Map();
  const opened = [], shown = [];
  const self = {
    addEventListener: (name, handler) => handlers.set(name, handler),
    registration: { scope: 'https://example.com/coiny/', showNotification: async (title, options) => shown.push({ title, options }) },
    clients: { matchAll: async () => clients, openWindow: async url => opened.push(url) }
  };
  class MessageChannel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { postMessage: data => this.port1.onmessage?.({ data }) };
    }
  }
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL, MessageChannel, setTimeout, clearTimeout });
  const dispatch = async (name, event) => {
    let pending;
    handlers.get(name)({ ...event, waitUntil: promise => { pending = promise; } });
    await pending;
  };
  return { dispatch, opened, shown };
}

test('a notification click sends a target to an existing app without navigating away', async () => {
  const messages = [];
  let focused = false;
  const client = { url: 'https://example.com/coiny/?invite=keep', postMessage: (data, ports) => {
    if (ports?.length) ports[0].postMessage({ accepted: true });
    else messages.push(data);
  }, focus: async () => { focused = true; } };
  const sw = worker([{ url: 'https://example.com/other-app/', focus: () => assert.fail('wrong application') }, client]);
  await sw.dispatch('notificationclick', { notification: { data: target, close() {} } });
  assert.equal(focused, true);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'coiny:open-chat', target }]);
  assert.deepEqual(sw.opened, []);
});

test('a notification focuses the recipient tab instead of another signed-in account', async () => {
  const focused = [];
  const clients = ['bob', 'alice'].map(ownerId => ({
    url: 'https://example.com/coiny/',
    postMessage: (_data, ports) => { if (ports?.length) ports[0].postMessage({ accepted: ownerId === target.ownerId }); },
    focus: async () => focused.push(ownerId)
  }));
  const sw = worker(clients);
  await sw.dispatch('notificationclick', { notification: { data: target, close() {} } });
  assert.deepEqual(focused, ['alice']);
  assert.deepEqual(sw.opened, []);
});

test('a cold notification click opens the deployed subpath with its chat target', async () => {
  const sw = worker();
  await sw.dispatch('notificationclick', { notification: { data: target, close() {} } });
  const opened = new URL(sw.opened[0]);
  assert.equal(opened.pathname, '/coiny/');
  assert.equal(opened.searchParams.get('notificationChat'), target.chatId);
  assert.equal(opened.searchParams.get('notificationOwner'), target.ownerId);
});

test('push payloads cannot supply notification previews or external navigation URLs', async () => {
  const sw = worker();
  await sw.dispatch('push', { data: { json: () => ({ title: 'private sender', body: 'secret plaintext', data: { ...target, url: 'https://attacker.example' } }) } });
  assert.equal(sw.shown[0].title, 'Coiny');
  assert.equal(sw.shown[0].options.body, 'Новое сообщение');
  assert.equal(sw.shown[0].options.icon, 'https://example.com/coiny/favicon.svg');
  assert.equal(JSON.stringify(sw.shown).includes('secret plaintext'), false);
  assert.equal(JSON.stringify(sw.shown).includes('attacker.example'), false);
});
