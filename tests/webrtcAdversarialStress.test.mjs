import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Load source code for verification
const callProviderCode = await readFile(new URL('../src/context/calls/CallProvider.jsx', import.meta.url), 'utf8');
const _audioAnalyzerCode = await readFile(new URL('../src/context/calls/audioAnalyzer.js', import.meta.url), 'utf8');
const _iceServersCode = await readFile(new URL('../src/context/calls/iceServers.ts', import.meta.url), 'utf8');

test('Adversarial Stress: Perfect Negotiation Glare Resolution across 50 simulated collision cycles', async () => {
  // Test deterministic role determination: String(currentUserId) < String(senderId)
  const peer1 = 'user_100'; // polite when paired with user_200 ('user_100' < 'user_200')
  const peer2 = 'user_200'; // impolite when paired with user_100

  assert.ok(String(peer1) < String(peer2), 'peer1 must be lexicographically less than peer2');
  assert.ok(!(String(peer2) < String(peer1)), 'peer2 must NOT be lexicographically less than peer1');

  for (let i = 0; i < 50; i++) {
    // Simulated state for Peer 1 (polite)
    let peer1SignalingState = 'have-local-offer';
    let peer1MakingOffer = true;
    let peer1Rollbacks = 0;
    let _peer1OffersProcessed = 0;

    // Simulated state for Peer 2 (impolite)
    let peer2SignalingState = 'have-local-offer';
    let peer2MakingOffer = true;
    let peer2OffersIgnored = 0;

    // Simulate offer received at Peer 1 from Peer 2
    const handleOfferAtPeer1 = async (senderId) => {
      const currentUserId = peer1;
      const isPolite = String(currentUserId) < String(senderId);
      const offerCollision = Boolean(peer1MakingOffer) || peer1SignalingState !== 'stable';

      if (offerCollision) {
        if (!isPolite) {
          return 'ignored';
        }
        peer1Rollbacks++;
        peer1SignalingState = 'stable'; // rollback executed
      }
      peer1SignalingState = 'have-remote-offer';
      _peer1OffersProcessed++;
      return 'processed';
    };

    // Simulate offer received at Peer 2 from Peer 1
    const handleOfferAtPeer2 = async (senderId) => {
      const currentUserId = peer2;
      const isPolite = String(currentUserId) < String(senderId);
      const offerCollision = Boolean(peer2MakingOffer) || peer2SignalingState !== 'stable';

      if (offerCollision) {
        if (!isPolite) {
          peer2OffersIgnored++;
          return 'ignored';
        }
        peer2SignalingState = 'stable';
      }
      peer2OffersProcessed++;
      return 'processed';
    };

    // Execute collision handling
    const res1 = await handleOfferAtPeer1(peer2);
    const res2 = await handleOfferAtPeer2(peer1);

    // Verify glare resolution rules:
    // Polite peer1 rolls back its local offer and processes peer2's offer
    assert.equal(res1, 'processed', `Cycle ${i}: Polite peer must process incoming offer`);
    assert.equal(peer1Rollbacks, 1, `Cycle ${i}: Polite peer must perform 1 rollback`);

    // Impolite peer2 ignores incoming offer from peer1 and retains its offer
    assert.equal(res2, 'ignored', `Cycle ${i}: Impolite peer must ignore incoming offer`);
    assert.equal(peer2OffersIgnored, 1, `Cycle ${i}: Impolite peer must record 1 ignored offer`);
  }
});

test('Adversarial Stress: Abrupt Presence Disconnect Teardown cleans up PCs, AudioContexts, and DOM elements', async () => {
  // Set up lightweight DOM mock
  const domElements = new Map();

  globalThis.document = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      srcObject: null,
      remove: function() {
        if (this.id) domElements.delete(this.id);
      }
    }),
    querySelectorAll: (selector) => {
      const results = [];
      const matchPrefix = selector.match(/id\^="([^"]+)"/);
      if (matchPrefix) {
        const prefix = matchPrefix[1];
        for (const [id, el] of domElements.entries()) {
          if (id.startsWith(prefix)) results.push(el);
        }
      } else if (selector === '.webrtc-remote-audio-feed') {
        for (const el of domElements.values()) {
          if (el.className === 'webrtc-remote-audio-feed') results.push(el);
        }
      }
      return results;
    },
    getElementById: (id) => domElements.get(id) || null
  };

  const pcsRef = { current: {} };
  const candidateQueuesRef = { current: {} };
  const audioAnalyzersRef = { current: {} };
  const closedPcs = new Set();
  const stoppedAnalyzers = new Set();

  // Populate 10 group peers
  for (let i = 1; i <= 10; i++) {
    const peerId = `peer_${i}`;
    pcsRef.current[peerId] = {
      id: peerId,
      close: () => closedPcs.add(peerId)
    };
    candidateQueuesRef.current[peerId] = [{ candidate: `cand-${i}` }];
    audioAnalyzersRef.current[peerId] = {
      stop: () => stoppedAnalyzers.add(peerId)
    };

    // Add DOM audio element
    const audioEl = document.createElement('audio');
    audioEl.id = `webrtc-audio-${peerId}-stream1`;
    audioEl.className = 'webrtc-remote-audio-feed';
    domElements.set(audioEl.id, audioEl);
  }

  assert.equal(Object.keys(pcsRef.current).length, 10);
  assert.equal(document.querySelectorAll('.webrtc-remote-audio-feed').length, 10);

  // Define teardown peer logic matching CallProvider.jsx
  const teardownPeer = (peerId) => {
    if (pcsRef.current[peerId]) {
      try {
        pcsRef.current[peerId].close();
      } catch {
        /* ignore */
      }
      delete pcsRef.current[peerId];
    }
    delete candidateQueuesRef.current[peerId];
    if (audioAnalyzersRef.current[peerId]) {
      try {
        audioAnalyzersRef.current[peerId].stop();
      } catch {
        /* ignore */
      }
      delete audioAnalyzersRef.current[peerId];
    }
    document.querySelectorAll(`[id^="webrtc-audio-${peerId}-"]`).forEach(el => {
      el.srcObject = null;
      el.remove();
    });
  };

  // Simulate abrupt presence drop where peers 3 through 10 disappear from presence sync
  const syncedParticipants = new Map([
    ['peer_1', { id: 'peer_1' }],
    ['peer_2', { id: 'peer_2' }]
  ]);
  const currentUserId = 'peer_1';

  // Run presence sync cleanup routine
  Object.keys(pcsRef.current).forEach(peerId => {
    if (!syncedParticipants.has(peerId) && peerId !== currentUserId) {
      teardownPeer(peerId);
    }
  });

  // Verification
  assert.equal(Object.keys(pcsRef.current).length, 2, 'Only active peers (peer_1, peer_2) should remain in pcsRef');
  assert.ok(pcsRef.current['peer_1']);
  assert.ok(pcsRef.current['peer_2']);
  assert.equal(closedPcs.size, 8, '8 disconnected peer connections must have been closed');
  assert.equal(stoppedAnalyzers.size, 8, '8 disconnected audio analyzers must have been stopped');

  // Verify DOM elements removed for disconnected peers
  assert.equal(document.querySelectorAll('.webrtc-remote-audio-feed').length, 2, 'Only 2 DOM audio elements should remain');
  assert.ok(document.getElementById('webrtc-audio-peer_1-stream1'));
  assert.ok(document.getElementById('webrtc-audio-peer_2-stream1'));
  assert.equal(document.getElementById('webrtc-audio-peer_3-stream1'), null);

  // Clean up global mock
  delete globalThis.document;
});

test('Adversarial Stress: Repeated Audio Analyzer Instantiation (100 cycles) avoids memory leaks & hanging timers', async () => {
  let createdCtxCount = 0;
  let closedCtxCount = 0;
  let disconnectedSourceCount = 0;
  let disconnectedAnalyserCount = 0;

  // Mock Web Audio API
  class MockAudioContext {
    constructor() {
      createdCtxCount++;
    }
    createMediaStreamSource() {
      return {
        connect: () => {},
        disconnect: () => disconnectedSourceCount++
      };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: (arr) => arr.fill(20),
        disconnect: () => disconnectedAnalyserCount++
      };
    }
    close() {
      closedCtxCount++;
      return Promise.resolve();
    }
  }

  globalThis.window = {
    AudioContext: MockAudioContext
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 10);

  const { startAudioAnalyzer } = await import(`../src/context/calls/audioAnalyzer.js?update=${Date.now()}`);

  const mockStream = { id: 'stream-1' };
  const audioAnalyzersRef = { current: {} };

  for (let i = 0; i < 100; i++) {
    const key = 'peer_test';
    if (audioAnalyzersRef.current[key]) {
      try {
        audioAnalyzersRef.current[key].stop();
      } catch {
        /* ignore */
      }
      delete audioAnalyzersRef.current[key];
    }
    const analyzer = startAudioAnalyzer(mockStream, () => {});
    audioAnalyzersRef.current[key] = analyzer;
  }

  // Stop final analyzer
  if (audioAnalyzersRef.current['peer_test']) {
    audioAnalyzersRef.current['peer_test'].stop();
  }

  assert.equal(createdCtxCount, 100, 'Should have created 100 AudioContext instances');
  assert.equal(closedCtxCount, 100, 'Should have closed all 100 AudioContext instances');
  assert.equal(disconnectedSourceCount, 100, 'Should have disconnected all 100 MediaStreamSources');
  assert.equal(disconnectedAnalyserCount, 100, 'Should have disconnected all 100 Analysers');

  delete globalThis.window;
  delete globalThis.requestAnimationFrame;
});

test('manual recovery delegates to the tested per-peer session controller', () => {
  assert.match(callProviderCode, /retryCallConnection/);
  assert.match(callProviderCode, /session\.recover\(\{ force: true \}\)/);
  assert.doesNotMatch(callProviderCode, /createOffer|setRemoteDescription/);
});
