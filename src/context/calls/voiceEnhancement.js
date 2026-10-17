import noiseGateWorkletUrl from './noiseGate.worklet.js?url';

export const CALL_AUDIO_CONSTRAINTS = Object.freeze({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1
});

function audioSenders(primary, mesh) {
  return [...new Set([primary, ...Object.values(mesh || {})].filter(Boolean))]
    .filter(connection => connection.connectionState !== 'closed' && connection.signalingState !== 'closed')
    .flatMap(connection => connection.getSenders()
      .filter(sender => sender.track?.kind === 'audio')
      .map(sender => ({ connection, sender, previousTrack: sender.track })));
}

function isClosed(connection) {
  return connection.connectionState === 'closed' || connection.signalingState === 'closed';
}

function cancelledError() {
  return new DOMException('Voice enhancement was cancelled.', 'AbortError');
}

export class VoiceEnhancementPipeline {
  constructor() {
    this.context = null;
    this.stream = null;
    this.originalTrack = null;
    this.processedTrack = null;
    this.nodes = [];
    this.queue = Promise.resolve();
    this.generation = 0;
    this.pending = null;
    this.resource = null;
  }

  get active() {
    return Boolean(this.processedTrack);
  }

  // The original microphone is hidden from the public stream while processing.
  // Muting both also keeps a partially rolled back mesh silent.
  setMuted(muted) {
    for (const resource of [this.resource, this.pending]) {
      if (!resource) continue;
      resource.originalTrack.enabled = !muted;
      if (resource.processedTrack) resource.processedTrack.enabled = !muted;
    }
  }

  enqueue(operation) {
    const generation = this.generation;
    const result = this.queue.then(() => {
      if (generation !== this.generation) throw cancelledError();
      return operation(generation);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  async closeResource(resource, stopOriginal = false) {
    if (!resource) return;
    if (stopOriginal) resource.originalTrack.stop();
    resource.processedTrack?.stop();
    resource.nodes.forEach(node => {
      try { node.disconnect?.(); } catch { /* Already disconnected during teardown. */ }
    });
    await resource.context.close().catch(() => undefined);
  }

  adopt(resource) {
    this.resource = resource;
    this.context = resource.context;
    this.stream = resource.stream;
    this.originalTrack = resource.originalTrack;
    this.processedTrack = resource.processedTrack;
    this.nodes = resource.nodes;
    resource.processedTrack.enabled = resource.originalTrack.enabled;
    resource.stream.removeTrack(resource.originalTrack);
    resource.stream.addTrack(resource.processedTrack);
  }

  clear() {
    this.resource = null;
    this.context = null;
    this.stream = null;
    this.originalTrack = null;
    this.processedTrack = null;
    this.nodes = [];
  }

  async replace(senders, track, generation) {
    const results = await Promise.allSettled(senders.map(({ sender }) => Promise.resolve().then(() => sender.replaceTrack(track))));
    if (generation !== this.generation) throw cancelledError();
    const failure = results.find((result, index) => result.status === 'rejected' && !isClosed(senders[index].connection));
    if (!failure) return;

    // Wait for every replacement before rollback: a late successful replacement
    // must not switch back to a graph that has already been closed.
    await Promise.allSettled(senders.map(({ sender, previousTrack, connection }, index) => {
      if (results[index].status !== 'fulfilled' || isClosed(connection)) return undefined;
      return Promise.resolve().then(() => sender.replaceTrack(previousTrack));
    }));
    if (generation !== this.generation) throw cancelledError();
    throw failure.reason;
  }

  enable(stream, primaryPeer, meshPeers) {
    return this.enqueue(async generation => {
      if (this.active) return;
      const originalTrack = stream?.getAudioTracks?.()[0];
      if (!originalTrack || originalTrack.readyState === 'ended') throw new Error('Microphone track is unavailable.');
      const context = new AudioContext({ latencyHint: 'interactive' });
      const resource = { context, stream, originalTrack, processedTrack: null, nodes: [] };
      this.pending = resource;
      const participants = new Set();
      try {
        if (context.state === 'suspended') await context.resume();
        if (generation !== this.generation) throw cancelledError();
        await context.audioWorklet.addModule(noiseGateWorkletUrl);
        if (generation !== this.generation) throw cancelledError();
        const source = context.createMediaStreamSource(new MediaStream([originalTrack]));
        const highPass = new BiquadFilterNode(context, { type: 'highpass', frequency: 80, Q: 0.707 });
        const compressor = new DynamicsCompressorNode(context, {
          threshold: -24, knee: 18, ratio: 3, attack: 0.003, release: 0.25
        });
        const gate = new AudioWorkletNode(context, 'coiny-noise-gate');
        const destination = context.createMediaStreamDestination();
        resource.nodes = [source, highPass, compressor, gate, destination];
        resource.processedTrack = destination.stream.getAudioTracks()[0];
        resource.processedTrack.enabled = originalTrack.enabled;
        source.connect(highPass).connect(compressor).connect(gate).connect(destination);
        let senders;
        do {
          senders = audioSenders(primaryPeer, meshPeers)
            .filter(({ sender }) => sender.track !== resource.processedTrack);
          senders.forEach(({ sender }) => participants.add(sender));
          if (senders.length) await this.replace(senders, resource.processedTrack, generation);
        } while (senders.length);
        this.adopt(resource);
      } catch (error) {
        // A failed rollback can leave a sender using the processed track. Keep
        // the graph alive; a later disable can retry without cutting its audio.
        const inUse = generation === this.generation && resource.processedTrack &&
          [...participants, ...audioSenders(primaryPeer, meshPeers).map(({ sender }) => sender)]
            .some(sender => sender.track === resource.processedTrack);
        if (inUse) this.adopt(resource);
        else await this.closeResource(resource, generation !== this.generation);
        throw error;
      } finally {
        if (this.pending === resource) this.pending = null;
      }
    });
  }

  disable(primaryPeer, meshPeers) {
    return this.enqueue(async generation => {
      if (!this.active) return;
      const resource = this.resource;
      resource.originalTrack.enabled = resource.processedTrack.enabled;
      let senders;
      do {
        senders = audioSenders(primaryPeer, meshPeers)
          .filter(({ sender }) => sender.track === resource.processedTrack);
        if (senders.length) await this.replace(senders, resource.originalTrack, generation);
      } while (senders.length);
      resource.originalTrack.enabled = resource.processedTrack.enabled;
      resource.stream.removeTrack(resource.processedTrack);
      resource.stream.addTrack(resource.originalTrack);
      this.clear();
      await this.closeResource(resource);
    });
  }

  // Ending a call invalidates queued work immediately. Do not replace tracks on
  // closing peer connections or leave the hidden microphone capturing audio.
  dispose() {
    this.generation += 1;
    this.queue = Promise.resolve();
    const resources = [...new Set([this.resource, this.pending].filter(Boolean))];
    this.clear();
    this.pending = null;
    return Promise.all(resources.map(resource => this.closeResource(resource, true))).then(() => undefined);
  }
}
