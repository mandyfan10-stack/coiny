const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 8_000];
const ufrags = (sdp = '') => new Set([...sdp.matchAll(/^a=ice-ufrag:([^\r\n]+)/gm)].map((match) => match[1]));

/** One serialized negotiation/recovery owner per RTCPeerConnection. */
export function createCallPeerSession({
  pc, polite, send, prepareRestart = async () => null,
  getAudioTrack = () => null,
  getVideoKind, getVideoRevision, onRemoteVideoKind = () => {},
  onState = () => {}, onError = () => {}, isCurrent = () => true, group = false,
  schedule = setTimeout, cancel = clearTimeout,
  retryDelays = RETRY_DELAYS, recoveryGraceMs = 3_000
}) {
  let disposed = false;
  let queue = Promise.resolve();
  let pending = null;
  let retryTimer = null;
  let recoveryTimer = null;
  let recoveryAttempts = 0;
  let recoveryQueued = false;
  let restartRequest = null;
  let requestTimer = null;
  let candidateTimer = null;
  let lastLocalSignal = null;
  let negotiated = false;
  let remoteId = null;
  let localId = null;
  let sequence = 0;
  let deferredNegotiation = false;
  let announcedState;
  let needsAudioRepair = false;
  const prefix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const answers = new Map();
  const ignored = new Set();
  const retired = new Set();
  const candidates = [];
  const localCandidates = new Map();
  const localGenerations = new Map();
  const active = () => !disposed && isCurrent() && pc.signalingState !== 'closed';
  const healthy = () => pc.connectionState === 'connected';
  const report = (error) => { if (active()) onError(error); };
  const state = (value) => {
    if (active() && announcedState !== value) { announcedState = value; onState(value); }
  };
  const describeVideo = signal => {
    if (!getVideoKind) return signal;
    const kind = getVideoKind();
    if (kind !== null && kind !== 'camera' && kind !== 'screen') return signal;
    const revision = getVideoRevision?.();
    return { ...signal, videoKind: kind,
      ...(Number.isSafeInteger(revision) && revision >= 0 ? { videoRevision: revision } : {}) };
  };
  const applyRemoteVideo = signal => {
    // Older clients have no source metadata. A remote track's label is a
    // browser-generated value, so use the ordinary video presentation instead.
    const kind = signal.videoKind;
    const revision = Number.isSafeInteger(signal.videoRevision) && signal.videoRevision >= 0 ? signal.videoRevision : undefined;
    onRemoteVideoKind(kind === null || kind === 'screen' ? kind : 'camera', revision);
  };
  const enqueue = (work) => {
    const next = queue.then(() => active() ? work() : undefined).catch(report);
    queue = next;
    return next;
  };
  const remember = (collection, key, value) => {
    if (collection.set) collection.set(key, value);
    else collection.add(key);
    if (collection.size > 12) collection.delete(collection.keys().next().value);
  };
  const clearRetry = () => { if (retryTimer !== null) cancel(retryTimer); retryTimer = null; };
  const clearRecovery = () => { if (recoveryTimer !== null) cancel(recoveryTimer); recoveryTimer = null; };
  const clearRequest = () => { if (requestTimer !== null) cancel(requestTimer); requestTimer = null; restartRequest = null; };
  const clearCandidateRetry = () => { if (candidateTimer !== null) cancel(candidateTimer); candidateTimer = null; };
  const stopPending = () => {
    clearRetry();
    if (pending) remember(retired, pending.signal.negotiationId);
    pending = null;
  };
  const transmit = (signal) => {
    if (!active()) return;
    // Sending never blocks processing an answer or call teardown. The callback
    // creates a fresh encrypted envelope for each repeat of the same SDP.
    Promise.resolve().then(() => active() ? send(signal) : undefined).catch(report);
  };
  const repeat = (signal) => {
    transmit(signal);
    for (const candidate of localCandidates.get(signal.negotiationId) ?? []) transmit(candidate);
  };
  const retryCandidatesUntilConnected = () => {
    if (candidateTimer !== null || !lastLocalSignal || healthy() || !active()) return;
    const generation = lastLocalSignal;
    let attempt = 0;
    const retry = () => {
      candidateTimer = null;
      if (!active() || healthy() || lastLocalSignal !== generation) return;
      if (!pending) repeat(generation);
      if (attempt < retryDelays.length) candidateTimer = schedule(retry, retryDelays[attempt++]);
      else state('failed');
    };
    candidateTimer = schedule(retry, retryDelays[attempt++]);
  };
  const armRetry = (offer) => {
    clearRetry();
    if (!active() || pending !== offer) return;
    if (offer.attempt >= retryDelays.length) {
      if (!healthy()) state('failed');
      return;
    }
    retryTimer = schedule(() => {
      retryTimer = null;
      if (!active() || pending !== offer) return;
      offer.attempt += 1;
      repeat(offer.signal);
      armRetry(offer);
    }, retryDelays[offer.attempt]);
  };
  const rememberLocal = (description, id) => {
    localId = id;
    const fragments = ufrags(description.sdp);
    for (const fragment of fragments) remember(localGenerations, fragment, id);
    // Rollback can reuse ICE credentials already gathered for the abandoned
    // offer. Replay those candidates with the accepted negotiation ID, since
    // the other peer correctly discarded the colliding offer's candidates.
    const saved = [];
    const seen = new Set();
    for (const batch of localCandidates.values()) {
      for (const signal of batch) {
        if (!fragments.has(signal.candidate.usernameFragment)) continue;
        const key = JSON.stringify(signal.candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        saved.push({ type: 'candidate', candidate: signal.candidate, ...(id ? { negotiationId: id } : {}) });
      }
    }
    if (saved.length) remember(localCandidates, id, saved.slice(0, 64));
  };
  const repairAudioSenders = async () => {
    for (const sender of pc.getSenders?.() ?? []) {
      const track = sender.track;
      if (track?.kind !== 'audio' || track.readyState !== 'live') continue;
      await sender.replaceTrack(null);
      if (!active()) return;
      // Voice processing may switch the stream while this native replacement
      // is pending. Restore its current track, not a now-stopped DSP output.
      let ownedTrack = null;
      while (active() && sender.track === ownedTrack) {
        const currentTrack = getAudioTrack() ?? track;
        if (currentTrack?.kind !== 'audio' || currentTrack.readyState !== 'live' || currentTrack === ownedTrack) break;
        await sender.replaceTrack(currentTrack);
        // A pipeline change can also finish during this second native await.
        // Reconcile only replacements we own; external changes win.
        ownedTrack = currentTrack;
      }
      if (!active()) return;
    }
    needsAudioRepair = false;
  };

  const offer = async (iceRestart) => {
    if (pending || pc.signalingState === 'have-local-offer') {
      if (!iceRestart) deferredNegotiation = true;
      if (pending) { repeat(pending.signal); armRetry(pending); }
      return;
    }
    if (pc.signalingState !== 'stable') { deferredNegotiation = true; return; }
    if (iceRestart) {
      const configuration = await prepareRestart();
      if (!active()) return;
      if (configuration) pc.setConfiguration(configuration);
    }
    const description = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (!active()) return;
    const id = `${prefix}:${++sequence}`;
    rememberLocal(description, id);
    await pc.setLocalDescription(description);
    if (!active()) return;
    const signal = describeVideo({ type: group || !negotiated ? 'offer' : 'renegotiate-offer', sdp: pc.localDescription.sdp, negotiationId: id });
    if (iceRestart) signal.iceRestart = true;
    pending = { signal, attempt: 0 };
    clearCandidateRetry();
    lastLocalSignal = signal;
    repeat(signal);
    armRetry(pending);
    if (!healthy()) state('connecting');
  };
  const flushCandidates = async () => {
    for (let index = 0; index < candidates.length;) {
      const signal = candidates[index];
      if (signal.negotiationId && signal.negotiationId !== remoteId) { index += 1; continue; }
      const fragment = signal.candidate?.usernameFragment;
      if (fragment && !ufrags(pc.remoteDescription?.sdp).has(fragment)) { index += 1; continue; }
      candidates.splice(index, 1);
      try { await pc.addIceCandidate(signal.candidate); }
      catch (error) { report(error); }
      if (!active()) return;
    }
  };
  const requestRestart = () => {
    if (restartRequest) return;
    restartRequest = { type: 'restart-request', requestId: `${prefix}:restart:${++sequence}` };
    let attempt = 0;
    const retry = () => {
      if (!active() || !restartRequest) return;
      transmit(restartRequest);
      if (attempt < 3) requestTimer = schedule(retry, [1_000, 2_000, 4_000][attempt++]);
      else {
        // Older clients do not understand restart-request. Fall back once,
        // after allowing the elected offerer time to refresh TURN and answer.
        clearRequest();
        void recover({ force: true, delegated: true });
      }
    };
    retry();
  };
  const recover = ({ force = false, delegated = false } = {}) => {
    if (!active() || recoveryQueued || (!force && healthy())) return Promise.resolve();
    if (force) recoveryAttempts = 0;
    if (recoveryAttempts >= 4) { state('failed'); return Promise.resolve(); }
    recoveryQueued = true;
    clearRecovery();
    return enqueue(async () => {
      try {
        if (!force && healthy()) return;
        recoveryAttempts += 1;
        if (!healthy()) state('connecting');
        if (pending && pending.attempt >= retryDelays.length) {
          stopPending();
          await pc.setLocalDescription({ type: 'rollback' });
          if (!active()) return;
          needsAudioRepair = true;
        }
        // A single elected peer initiates ICE restarts. Concurrent restart
        // rollback can leave Chromium's live audio sender sending no RTP.
        if (polite && !delegated && !pending) { requestRestart(); return; }
        await offer(true);
      } catch (error) {
        if (!active()) return;
        report(error);
        if (!healthy()) {
          state('failed');
          if (recoveryAttempts < 4) recoveryTimer = schedule(() => {
            recoveryTimer = null;
            void recover();
          }, Math.min(8_000, 1_000 * (2 ** (recoveryAttempts - 1))));
        }
      } finally { recoveryQueued = false; }
    });
  };
  const transportChanged = () => {
    if (!active()) return;
    if (healthy()) {
      recoveryAttempts = 0;
      clearRecovery();
      clearCandidateRetry();
      state('connected');
      // Keep retrying unanswered SDP even when the previous ICE path is healthy.
      return;
    }
    state('connecting');
    if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
      void recover();
    } else if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
      if (recoveryTimer === null) recoveryTimer = schedule(() => { recoveryTimer = null; void recover(); }, recoveryGraceMs);
    }
  };
  const receive = (signal) => enqueue(async () => {
    if (!signal) return;
    if (signal.type === 'restart-request') {
      if (!polite) void recover({ force: true, delegated: true });
      return;
    }
    const id = signal.negotiationId;
    if (signal.type === 'candidate') {
      if ((id && (ignored.has(id) || retired.has(id))) || !signal.candidate) return;
      candidates.push(signal);
      if (candidates.length > 128) candidates.shift();
      if (pc.remoteDescription) await flushCandidates();
      return;
    }
    const isOffer = signal.type === 'offer' || signal.type === 'renegotiate-offer';
    const isAnswer = signal.type === 'answer' || signal.type === 'renegotiate-answer';
    if (!isOffer && !isAnswer) return;
    if (isOffer) {
      const key = id ?? `legacy:${signal.sdp}`;
      const cached = answers.get(key);
      if (cached) { repeat(cached); return; }
      if (id && (ignored.has(id) || retired.has(id))) return;
      clearRequest();
      const collision = pc.signalingState !== 'stable';
      if (collision && !polite) { if (id) remember(ignored, id); return; }
      if (collision) {
        stopPending();
        // setRemoteDescription performs the atomic polite rollback. Splitting
        // rollback and remote offer can interrupt Chromium's audio sender.
      }
      const previousFragments = ufrags(pc.remoteDescription?.sdp);
      const restarting = signal.iceRestart || (previousFragments.size && [...ufrags(signal.sdp)].some((fragment) => !previousFragments.has(fragment)));
      if (restarting) {
        try {
          const configuration = await prepareRestart();
          if (!active()) return;
          if (configuration) pc.setConfiguration(configuration);
        } catch (error) { report(error); }
        if (!active()) return;
      }
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      if (!active()) return;
      applyRemoteVideo(signal);
      if (remoteId && remoteId !== id) remember(retired, remoteId);
      remoteId = id ?? null;
      await flushCandidates();
      if (!active()) return;
      const answer = await pc.createAnswer();
      if (!active()) return;
      rememberLocal(answer, id ?? null);
      await pc.setLocalDescription(answer);
      if (!active()) return;
      // Chromium can keep the audio track live while its RTP sender stops after
      // rollback. Rebind that track; never acquire or stop a microphone here.
      if (collision || needsAudioRepair) await repairAudioSenders();
      if (!active()) return;
      const response = describeVideo({ type: signal.type === 'renegotiate-offer' && !group ? 'renegotiate-answer' : 'answer', sdp: pc.localDescription.sdp });
      if (id) response.negotiationId = id;
      remember(answers, key, response);
      clearCandidateRetry();
      lastLocalSignal = response;
      negotiated = true;
      repeat(response);
    } else {
      if (!pending || (id && id !== pending.signal.negotiationId) || pc.signalingState !== 'have-local-offer') return;
      const answeredId = pending.signal.negotiationId;
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      if (!active()) return;
      applyRemoteVideo(signal);
      if (needsAudioRepair) await repairAudioSenders();
      if (!active()) return;
      clearRetry();
      pending = null;
      if (remoteId && remoteId !== answeredId) remember(retired, remoteId);
      remoteId = answeredId;
      negotiated = true;
      await flushCandidates();
    }
    if (!active()) return;
    transportChanged();
    retryCandidatesUntilConnected();
    if (deferredNegotiation) { deferredNegotiation = false; await offer(false); }
  });
  const iceCandidate = ({ candidate }) => {
    if (!active() || !candidate) return;
    const serialized = candidate.toJSON?.() ?? candidate;
    const fragment = serialized.usernameFragment;
    const id = fragment ? localGenerations.get(fragment) : localId;
    if (fragment && !localGenerations.has(fragment)) return;
    if (id && retired.has(id)) return;
    const signal = { type: 'candidate', candidate: serialized };
    if (id) signal.negotiationId = id;
    const saved = localCandidates.get(id) ?? [];
    if (saved.length < 64) saved.push(signal);
    remember(localCandidates, id, saved);
    transmit(signal);
    retryCandidatesUntilConnected();
  };
  pc.addEventListener('icecandidate', iceCandidate);
  pc.addEventListener('connectionstatechange', transportChanged);
  pc.addEventListener('iceconnectionstatechange', transportChanged);
  return {
    negotiate: ({ iceRestart = false } = {}) => iceRestart ? recover({ force: true }) : enqueue(() => offer(false)),
    receive, recover, transportChanged,
    signalReady() {
      if (!active()) return;
      if (pending) { pending.attempt = 0; repeat(pending.signal); armRetry(pending); }
      else {
        const lastAnswer = [...answers.values()].at(-1);
        if (lastAnswer) repeat(lastAnswer);
        if (negotiated && !healthy()) void recover({ force: true });
      }
    },
    dispose() {
      disposed = true;
      clearRetry();
      clearRecovery();
      clearRequest();
      clearCandidateRetry();
      pc.removeEventListener('icecandidate', iceCandidate);
      pc.removeEventListener('connectionstatechange', transportChanged);
      pc.removeEventListener('iceconnectionstatechange', transportChanged);
      candidates.length = 0;
      answers.clear();
      localCandidates.clear();
    }
  };
}
