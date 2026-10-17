import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCallQuality, createCallQualitySampler } from '../src/context/calls/callQuality.js';

function report(step = 0) {
  return new Map([
    ['stale', { id: 'stale', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.9 }],
    ['pair', { id: 'pair', type: 'candidate-pair', currentRoundTripTime: 0.024, localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
    ['local', { id: 'local', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls', address: '192.0.2.1', usernameFragment: 'secret' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'host', address: '192.0.2.2' }],
    ['in', { id: 'in', type: 'inbound-rtp', kind: 'audio', timestamp: 1000 + step * 2000, transportId: 'transport', packetsReceived: 100 + step * 96, packetsLost: 2 + step * 4, bytesReceived: 1000 + step * 960, jitter: 0.003, jitterBufferDelay: 1 + step * 0.2, jitterBufferEmittedCount: 100 + step * 20 }],
    ['out', { id: 'out', type: 'outbound-rtp', kind: 'audio', timestamp: 1000 + step * 2000, transportId: 'transport', remoteId: 'remote-in', packetsSent: 100 + step * 100, bytesSent: 1000 + step * 1000 }],
    ['remote-in', { id: 'remote-in', type: 'remote-inbound-rtp', kind: 'audio', timestamp: 1000 + step * 2000, packetsReceived: 100 + step * 98, packetsLost: 2 + step * 2, roundTripTime: 0.03, jitter: 0.004 }]
  ]);
}

test('uses the selected transport pair and measures RTP deltas in both directions', () => {
  const quality = collectCallQuality(report(1), report());
  assert.equal(quality.rttMs, 24);
  assert.equal(quality.protocol, 'udp');
  assert.equal(quality.localCandidateType, 'relay');
  assert.equal(quality.relayProtocol, 'tls');
  assert.equal(quality.inbound.packets, 96);
  assert.equal(quality.inbound.bytes, 960);
  assert.equal(quality.inbound.lossPercent, 4);
  assert.equal(quality.inbound.jitterMs, 3);
  assert.ok(Math.abs(quality.inbound.jitterBufferMs - 10) < 0.0001);
  assert.equal(quality.outbound.packets, 100);
  assert.equal(quality.outbound.lossPercent, 2);
  assert.equal(quality.outbound.rttMs, 30);
  assert.equal(quality.inbound.active, true);
  assert.equal(quality.outbound.active, true);
  const serialized = JSON.stringify(quality);
  assert.doesNotMatch(serialized, /192\.0\.2|secret|remote-in|transport|candidateId|sdp|username/);
});

test('first samples, missing fields and absent selected pairs remain unknown', () => {
  const first = collectCallQuality(report());
  assert.equal(first.inbound.active, null);
  assert.equal(first.inbound.lossPercent, null);
  assert.equal(first.inbound.jitterBufferMs, null);
  const empty = collectCallQuality(new Map());
  assert.equal(empty.rttMs, null);
  assert.equal(empty.selectedPair, false);
  assert.equal(empty.outbound.packets, null);
  const partial = report(1);
  partial.delete('transport');
  delete partial.get('in').packetsLost;
  delete partial.get('out').remoteId;
  assert.equal(collectCallQuality(partial, report()).rttMs, null);
  assert.equal(collectCallQuality(partial, report()).inbound.lossPercent, null);
  assert.equal(collectCallQuality(partial, report()).outbound.lossPercent, null);
});

test('no RTP traffic is distinguished from unknown traffic; counter resets do not produce negative loss', () => {
  const unchanged = report(1);
  for (const stat of unchanged.values()) if (stat.timestamp) stat.timestamp += 2000;
  const quality = collectCallQuality(unchanged, report(1));
  assert.equal(quality.inbound.active, false);
  assert.equal(quality.outbound.active, false);
  assert.equal(quality.inbound.lossPercent, null);
  assert.equal(quality.inbound.jitterBufferMs, null);
  const reset = report();
  for (const stat of reset.values()) if (stat.timestamp) stat.timestamp += 10_000;
  assert.equal(collectCallQuality(reset, report(1)).inbound.packets, null);
  assert.equal(collectCallQuality(reset, report(1)).inbound.lossPercent, null);
});

test('sampler isolates peers, clears failed samples, and resets on teardown', async () => {
  const sampler = createCallQualitySampler();
  let value = report();
  let fail = false;
  const pc = { getStats: async () => { if (fail) throw new Error('closed'); return value; } };
  assert.equal((await sampler.sample(pc)).inbound.active, null);
  value = report(1);
  assert.equal((await sampler.sample(pc)).inbound.active, true);
  assert.equal((await sampler.sample({ getStats: async () => value })).inbound.active, null);
  fail = true;
  assert.equal(await sampler.sample(pc), null);
  fail = false;
  value = report(2);
  assert.equal((await sampler.sample(pc)).inbound.active, null);
  sampler.reset(pc);
  assert.equal((await sampler.sample(pc)).inbound.active, null);
  sampler.reset();
  assert.equal((await sampler.sample(pc)).inbound.active, null);
});

test('concurrent sampling is single-flight and an in-flight sample after reset is discarded', async () => {
  let finish;
  let calls = 0;
  const pc = { getStats: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const sampler = createCallQualitySampler();
  const a = sampler.sample(pc);
  const b = sampler.sample(pc);
  assert.equal(calls, 1);
  sampler.reset(pc);
  finish(report());
  assert.equal(await a, null);
  assert.equal(await b, null);
});

test('synchronously throwing getStats clients remain retryable', async () => {
  let calls = 0;
  const pc = { getStats() { if (++calls === 1) throw new Error('closed'); return Promise.resolve(report()); } };
  const sampler = createCallQualitySampler();
  assert.equal(await sampler.sample(pc), null);
  assert.notEqual(await sampler.sample(pc), null);
  assert.equal(calls, 2);
});
