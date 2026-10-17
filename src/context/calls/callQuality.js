// Only aggregate measurements leave this module. Addresses, SDP, credentials and
// browser stats identifiers are deliberately excluded from the public result.
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = value => finite(value) !== null && value >= 0 ? value : null;
const ms = value => nonnegative(value) === null ? null : value * 1000;
const sum = values => values.length && values.every(value => value !== null)
  ? values.reduce((total, value) => total + value, 0) : null;
const maximum = values => {
  const known = values.filter(value => value !== null);
  return known.length ? Math.max(...known) : null;
};
const delta = (current, previous, field) => {
  if (!previous || !(current.timestamp > previous.timestamp)) return null;
  const a = nonnegative(current[field]);
  const b = nonnegative(previous[field]);
  return a !== null && b !== null && a >= b ? a - b : null;
};
const ratio = (numerator, denominator, multiplier = 1) => numerator !== null && denominator > 0
  ? numerator / denominator * multiplier : null;
const audio = stat => (stat.kind ?? stat.mediaType) === 'audio';
const snapshot = report => {
  const result = new Map();
  report?.forEach(stat => { if (stat?.id) result.set(stat.id, { ...stat }); });
  return result;
};
const oneOf = (value, choices) => choices.includes(value) ? value : null;

/** Read a single audio connection. Deltas describe the interval between reports,
 * never lifetime counters. The first sample and unsupported fields remain null.
 * RTT measures a network round trip; it is not a measurement of speech latency.
 */
export function collectCallQuality(report, previousReport = null) {
  const stats = snapshot(report);
  const previous = snapshot(previousReport);
  const values = [...stats.values()];
  const incoming = values.filter(stat => stat.type === 'inbound-rtp' && audio(stat));
  const outgoing = values.filter(stat => stat.type === 'outbound-rtp' && audio(stat));
  const transports = incoming.concat(outgoing).map(stat => stats.get(stat.transportId)).filter(Boolean);
  const selectedId = transports.find(stat => stat.selectedCandidatePairId)?.selectedCandidatePairId
    ?? values.find(stat => stat.type === 'transport' && stat.selectedCandidatePairId)?.selectedCandidatePairId;
  // Do not substitute the first nominated pair: browsers may retain an old pair
  // after an ICE restart alongside the one actually selected by the transport.
  const pair = stats.get(selectedId);
  const selected = pair?.type === 'candidate-pair' ? pair : null;
  const local = stats.get(selected?.localCandidateId);
  const remote = stats.get(selected?.remoteCandidateId);
  const packetsReceived = sum(incoming.map(stat => delta(stat, previous.get(stat.id), 'packetsReceived')));
  const packetsSent = sum(outgoing.map(stat => delta(stat, previous.get(stat.id), 'packetsSent')));
  const inboundLost = sum(incoming.map(stat => delta(stat, previous.get(stat.id), 'packetsLost')));
  const bufferDelay = sum(incoming.map(stat => delta(stat, previous.get(stat.id), 'jitterBufferDelay')));
  const bufferCount = sum(incoming.map(stat => delta(stat, previous.get(stat.id), 'jitterBufferEmittedCount')));
  const remoteReports = outgoing.map(stat => stats.get(stat.remoteId));
  const outboundLost = sum(remoteReports.map(stat => stat ? delta(stat, previous.get(stat.id), 'packetsLost') : null));
  const outboundReceived = sum(remoteReports.map(stat => stat ? delta(stat, previous.get(stat.id), 'packetsReceived') : null));
  return {
    rttMs: ms(selected?.currentRoundTripTime),
    selectedPair: Boolean(selected),
    localCandidateType: oneOf(local?.candidateType, ['host', 'srflx', 'prflx', 'relay']),
    remoteCandidateType: oneOf(remote?.candidateType, ['host', 'srflx', 'prflx', 'relay']),
    protocol: oneOf(local?.protocol ?? remote?.protocol, ['udp', 'tcp']),
    relayProtocol: oneOf(local?.relayProtocol ?? remote?.relayProtocol, ['udp', 'tcp', 'tls']),
    inbound: {
      packets: packetsReceived,
      bytes: sum(incoming.map(stat => delta(stat, previous.get(stat.id), 'bytesReceived'))),
      packetsLost: inboundLost,
      lossPercent: ratio(inboundLost, packetsReceived === null || inboundLost === null ? null : packetsReceived + inboundLost, 100),
      jitterMs: maximum(incoming.map(stat => ms(stat.jitter))),
      jitterBufferMs: ratio(bufferDelay, bufferCount, 1000),
      active: packetsReceived === null ? null : packetsReceived > 0
    },
    outbound: {
      packets: packetsSent,
      bytes: sum(outgoing.map(stat => delta(stat, previous.get(stat.id), 'bytesSent'))),
      packetsLost: outboundLost,
      lossPercent: ratio(outboundLost, outboundReceived === null || outboundLost === null ? null : outboundReceived + outboundLost, 100),
      rttMs: maximum(remoteReports.map(stat => ms(stat?.roundTripTime))),
      jitterMs: maximum(remoteReports.map(stat => ms(stat?.jitter))),
      active: packetsSent === null ? null : packetsSent > 0
    }
  };
}

/** Per-peer history, with no overlapping getStats calls. Reset on call teardown.
 * A failed read yields null and discards the previous interval so recovery does
 * not report a long gap as though it were one current sampling interval.
 */
export function createCallQualitySampler() {
  let peers = new WeakMap();
  return {
    reset(pc) {
      if (pc) peers.delete(pc);
      else peers = new WeakMap();
    },
    async sample(pc) {
      if (!pc || typeof pc.getStats !== 'function' || pc.connectionState === 'closed') return null;
      let entry = peers.get(pc);
      if (!entry) peers.set(pc, entry = { report: null, pending: null });
      if (entry.pending) return entry.pending;
      const current = entry;
      current.pending = (async () => {
        try {
          const report = await pc.getStats();
          if (peers.get(pc) !== current || pc.connectionState === 'closed') return null;
          const quality = collectCallQuality(report, current.report);
          current.report = snapshot(report);
          return quality;
        } catch {
          current.report = null;
          return null;
        }
      })().finally(() => { current.pending = null; });
      return current.pending;
    }
  };
}
