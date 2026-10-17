import React from 'react';

const maximum = values => {
  const numbers = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) : null;
};
const milliseconds = value => value === null ? '—' : `${Math.round(value)} мс`;

export default function CallQuality({ peers = [] }) {
  const rtt = maximum(peers.map(peer => peer.rttMs));
  const jitter = maximum(peers.map(peer => peer.inbound?.jitterMs));
  const buffer = maximum(peers.map(peer => peer.inbound?.jitterBufferMs));
  const loss = maximum(peers.flatMap(peer => [peer.inbound?.lossPercent, peer.outbound?.lossPercent]));
  const known = peers.filter(peer => peer.selectedPair);
  const relay = known.some(peer => peer.localCandidateType === 'relay' || peer.remoteCandidateType === 'relay');
  return <details className="call-quality">
    <summary>Качество связи{rtt !== null ? ` · ${milliseconds(rtt)}` : ''}</summary>
    <dl>
      <div><dt>Пинг (RTT)</dt><dd>{milliseconds(rtt)}</dd></div>
      <div><dt>Потери пакетов</dt><dd>{loss === null ? '—' : `${loss.toFixed(1)} %`}</dd></div>
      <div><dt>Колебания задержки</dt><dd>{milliseconds(jitter)}</dd></div>
      <div><dt>Аудиобуфер</dt><dd>{milliseconds(buffer)}</dd></div>
      <div><dt>Маршрут</dt><dd>{known.length ? relay ? 'Через реле' : 'Прямой' : 'Определяется'}</dd></div>
    </dl>
    <p>RTT — время туда и обратно. Это не полная задержка голоса.
      {peers.length > 1 ? ' Для группы показаны наибольшие значения.' : ''}</p>
  </details>;
}
