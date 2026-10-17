import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { refreshIceConfiguration, getIceConfiguration, resetIceConfiguration } from '../src/context/calls/iceServers.ts';

beforeEach(resetIceConfiguration);
const payload = (name = 'alice', expiresAt = Date.now() + 600_000) => ({
  data: { available: true, expiresAt, iceServers: [{ urls: 'turn:relay.example.test', username: name, credential: 'secret' }] }
});
const relayUser = configuration => configuration.iceServers.find(server => server.username)?.username;

test('TURN requests single-flight per client and account; cached credentials honor each call policy', async () => {
  let finish;
  let calls = 0;
  const client = { functions: { invoke: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } };
  const first = refreshIceConfiguration({ cacheKey: 'alice' }, client);
  const second = refreshIceConfiguration({ cacheKey: 'alice', allowDirectConnection: true }, client);
  assert.equal(calls, 1);
  finish(payload());
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.iceTransportPolicy, 'relay');
  assert.equal(b.iceTransportPolicy, 'all');
  assert.equal(relayUser(await refreshIceConfiguration({ cacheKey: 'alice' }, client)), 'alice');
  assert.equal(calls, 1);
});

test('expiry safety margin and force refresh request new TURN credentials', async t => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const client = { functions: { invoke: async () => { calls++; return payload(`user-${calls}`); } } };
  assert.equal(relayUser(await refreshIceConfiguration({}, client)), 'user-1');
  assert.equal(relayUser(await refreshIceConfiguration({ forceRefresh: true }, client)), 'user-2');
  now += 571_000;
  assert.equal(relayUser(await refreshIceConfiguration({}, client)), 'user-3');
  assert.equal(calls, 3);
});

test('separate clients and account keys never share TURN credentials or pending requests', async () => {
  let calls = 0;
  const client = { functions: { invoke: async () => payload(`account-${++calls}`) } };
  assert.equal(relayUser(await refreshIceConfiguration({ cacheKey: 'a' }, client)), 'account-1');
  assert.equal(relayUser(await refreshIceConfiguration({ cacheKey: 'b' }, client)), 'account-2');
  assert.equal(relayUser(await refreshIceConfiguration({ cacheKey: 'a' }, client)), 'account-1');
  const other = { functions: { invoke: async () => payload('other-client') } };
  assert.equal(relayUser(await refreshIceConfiguration({ cacheKey: 'a' }, other)), 'other-client');
});

test('reset aborts pending credentials and late results cannot restore old account data', async () => {
  let finish;
  let signal;
  const client = { functions: { invoke: (_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } } };
  const pending = refreshIceConfiguration({ cacheKey: 'old-account' }, client);
  resetIceConfiguration();
  assert.equal(signal.aborted, true);
  finish(payload('old-account'));
  assert.equal(relayUser(await pending), undefined);
  assert.equal(relayUser(getIceConfiguration()), undefined);
});

test('a later account refresh wins over an older response even without reset', async () => {
  const finishes = [];
  const client = { functions: { invoke: () => new Promise(resolve => finishes.push(resolve)) } };
  const old = refreshIceConfiguration({ cacheKey: 'old' }, client);
  const fresh = refreshIceConfiguration({ cacheKey: 'fresh' }, client);
  finishes[1](payload('fresh'));
  await fresh;
  finishes[0](payload('old'));
  await old;
  assert.equal(relayUser(getIceConfiguration()), 'fresh');
});

test('timeout aborts a hung SDK call and falls back without waiting for a response', async () => {
  let signal;
  const client = { functions: { invoke: (_, options) => { signal = options.signal; return new Promise(() => {}); } } };
  const configuration = await refreshIceConfiguration({ requestTimeoutMs: 10 }, client);
  assert.equal(signal.aborted, true);
  assert.equal(configuration.iceTransportPolicy, 'all');
  assert.equal(relayUser(configuration), undefined);
});

test('expired TURN responses are discarded; unavailable/error responses remain retryable', async () => {
  for (const response of [payload('expired', Date.now() - 1), { data: { available: false } }, { error: new Error('offline') }]) {
    let calls = 0;
    const client = { functions: { invoke: async () => { calls++; return response; } } };
    assert.equal(relayUser(await refreshIceConfiguration({}, client)), undefined);
    await refreshIceConfiguration({}, client);
    assert.equal(calls, 2);
  }
});

test('synchronously throwing credential clients remain retryable', async () => {
  let calls = 0;
  const client = { functions: { invoke() { if (++calls === 1) throw new Error('offline'); return Promise.resolve(payload()); } } };
  assert.equal(relayUser(await refreshIceConfiguration({}, client)), undefined);
  assert.equal(relayUser(await refreshIceConfiguration({}, client)), 'alice');
  assert.equal(calls, 2);
});

test('failed proactive refresh keeps still-valid credentials, but never expired credentials', async t => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const client = { functions: { invoke: async () => ++calls === 1 ? payload() : { error: new Error('unavailable') } } };
  assert.equal(relayUser(await refreshIceConfiguration({}, client)), 'alice');
  assert.equal(relayUser(await refreshIceConfiguration({ forceRefresh: true }, client)), 'alice');
  now += 600_000;
  assert.equal(relayUser(await refreshIceConfiguration({ forceRefresh: true }, client)), undefined);
});

test('an explicit invalid expiry never introduces TURN credentials', async () => {
  for (const expiry of [0, NaN, Infinity, -1, 'future']) {
    const client = { functions: { invoke: async () => payload('invalid', expiry) } };
    assert.equal(relayUser(await refreshIceConfiguration({}, client)), undefined);
  }
});
