import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPushService, decodePushPublicKey } from '../src/services/webPushService.ts';
import { deliverPushBatch, isAllowedPushEndpoint, matchesPushSecret } from '../supabase/functions/_shared/webPushDelivery.ts';

const key = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
const endpoint = 'https://fcm.googleapis.com/fcm/send/device';
function fixture({ owner = null, subscribed = false } = {}) {
  const calls = [];
  const local = new Map(owner ? [['coingram-push-owner', owner]] : []);
  let active = subscribed;
  const subscription = {
    endpoint, options: { applicationServerKey: decodePushPublicKey(key) },
    toJSON: () => ({ keys: { p256dh: 'public-encryption-key', auth: 'authentication-secret' } }),
    unsubscribe: async () => { calls.push('unsubscribe'); active = false; return true; }
  };
  const rpc = async (name, args) => { calls.push({ name, args }); return { error: null }; };
  const worker = { pushManager: {
    getSubscription: async () => active ? subscription : null,
    subscribe: async options => { assert.equal(options.userVisibleOnly, true); calls.push('subscribe'); active = true; return subscription; }
  } };
  const service = createWebPushService({ client: { rpc }, publicKey: key, registration: async () => worker,
    permission: () => 'granted', storage: () => ({ getItem: name => local.get(name) || null, setItem: (name, value) => local.set(name, value), removeItem: name => local.delete(name) }) });
  return { calls, local, service, subscription, worker };
}

test('Web Push public keys reject malformed input before subscribing', () => {
  assert.equal(decodePushPublicKey(key).byteLength, 65);
  for (const invalid of ['', 'not-a-key', 'A'.repeat(87)]) assert.throws(() => decodePushPublicKey(invalid));
});

test('registration stores subscription keys through the authenticated RPC', async () => {
  const f = fixture();
  await f.service.sync('alice', true);
  assert.equal(f.calls[0], 'subscribe');
  assert.deepEqual(f.calls[1], { name: 'register_web_push_subscription', args: {
    p_endpoint: endpoint, p_p256dh: 'public-encryption-key', p_auth: 'authentication-secret'
  } });
  assert.equal(f.local.get('coingram-push-owner'), 'alice');
});

test('changing accounts invalidates the previous endpoint before registering a new one', async () => {
  const f = fixture({ owner: 'alice', subscribed: true });
  await f.service.sync('bob', true);
  assert.ok(f.calls.indexOf('unsubscribe') < f.calls.indexOf('subscribe'));
  assert.equal(f.local.get('coingram-push-owner'), 'bob');
});

test('queued sign-out wins over a still-pending registration', async () => {
  const f = fixture();
  await Promise.all([f.service.sync('alice', true), f.service.disable()]);
  assert.equal(f.local.has('coingram-push-owner'), false);
  assert.equal(await f.worker.pushManager.getSubscription(), null);
});

test('provider unsubscribe still runs when the authenticated delete fails', async () => {
  let removed = false;
  const service = createWebPushService({
    client: { rpc: async () => ({ error: new Error('expired token') }) }, publicKey: key,
    registration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint, unsubscribe: async () => { removed = true; return true; } }) } }),
    permission: () => 'granted', storage: () => undefined
  });
  await service.disable();
  assert.equal(removed, true);
});

test('push delivery rejects arbitrary endpoints and validates the webhook secret', async () => {
  for (const value of ['https://127.0.0.1/private', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.attacker.example/x', 'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8080/x']) {
    assert.equal(isAllowedPushEndpoint(value), false);
  }
  assert.equal(isAllowedPushEndpoint(endpoint), true);
  const secret = 's'.repeat(48);
  assert.equal(await matchesPushSecret(secret, secret), true);
  assert.equal(await matchesPushSecret('wrong', secret), false);
  assert.equal(await matchesPushSecret('', ''), false);
});

test('a stalled server delete cannot block sign-out after provider unsubscribe succeeds', async () => {
  let removed = false;
  const service = createWebPushService({
    client: { rpc: () => new Promise(() => {}) }, publicKey: key, timeoutMs: 5,
    registration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint, unsubscribe: async () => { removed = true; return true; } }) } }),
    permission: () => 'granted', storage: () => undefined
  });
  await service.disable();
  assert.equal(removed, true);
});

test('delivery removes expired endpoints, retains transient failures, and sends no message content', async () => {
  const sent = [], removed = [];
  const recipients = ['ok', 'gone', 'retry', 'blocked'].map(id => ({ id, owner_id: 'alice', endpoint: id === 'blocked' ? 'https://127.0.0.1/' : `${endpoint}/${id}`, p256dh: 'key', auth: 'secret' }));
  const result = await deliverPushBatch(recipients, { id: 'message-1', chat_id: 'chat-1', text: 'secret plaintext' }, {
    send: async (subscription, payload) => {
      sent.push({ subscription, payload });
      if (subscription.endpoint.endsWith('/gone')) throw { statusCode: 410 };
      if (subscription.endpoint.endsWith('/retry')) throw { statusCode: 503 };
    }, remove: async id => { removed.push(id); }
  });
  assert.deepEqual(result, { delivered: 1, failed: 3 });
  assert.deepEqual(removed, ['gone']);
  assert.equal(sent.length, 3);
  assert.equal(sent.some(item => item.payload.includes('secret plaintext')), false);
  assert.deepEqual(JSON.parse(sent[0].payload), { data: { ownerId: 'alice', chatId: 'chat-1', messageId: 'message-1' } });
});
