import { mkdir, writeFile } from 'node:fs/promises';

export function callFrameMilestone(payload) {
  let topic, event, body;
  if (Buffer.isBuffer(payload)) {
    // realtime-js encodes broadcasts as binary frames. Decode only the
    // protocol header and retain no message or encrypted envelope content.
    const kind = payload[0];
    if (kind === 3) {
      const start = 7 + payload[1] + payload[2];
      topic = payload.toString('utf8', start, start + payload[3]);
      event = payload.toString('utf8', start + payload[3], start + payload[3] + payload[4]);
    } else if (kind === 4) {
      topic = payload.toString('utf8', 5, 5 + payload[1]);
      event = payload.toString('utf8', 5 + payload[1], 5 + payload[1] + payload[2]);
    } else return null;
  } else {
    const frame = JSON.parse(String(payload));
    [, , topic, event, body] = Array.isArray(frame)
      ? frame : [null, null, frame.topic, frame.event, frame.payload];
    if (event === 'broadcast') event = body?.event;
  }
  if (!String(topic).startsWith('realtime:call:chat:')) return null;
  const allowed = ['phx_join', 'phx_reply', 'phx_error', 'phx_close', 'incoming-call', 'call-received', 'call-accepted', 'call-accepted-received', 'call-rejected', 'signal', 'hangup'];
  if (!allowed.includes(event)) return null;
  const status = ['ok', 'error'].includes(body?.status) ? body.status : undefined;
  return { kind: event, channel: String(topic).endsWith(':media') ? 'media' : 'invitation', ...(status ? { status } : {}) };
}

// Record protocol milestones only. Never retain payloads, chat/user IDs, URLs,
// tokens, passwords, encrypted envelopes, or arbitrary console text.
export function observeCallSignaling(page, label, diagnostics, startedAt) {
  const record = (kind, details = {}) => {
    if (diagnostics.length < 500) diagnostics.push({ peer: label, ms: Date.now() - startedAt, kind, ...details });
  };
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/realtime/')) return;
    record('socket-open');
    socket.on('close', () => record('socket-close'));
    for (const [hook, direction] of [['framesent', 'sent'], ['framereceived', 'received']]) {
      socket.on(hook, ({ payload }) => {
        try {
          const milestone = callFrameMilestone(payload);
          if (milestone) record(milestone.kind, { direction, ...milestone });
        } catch { /* Non-JSON protocol frame. */ }
      });
    }
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const value = message.text();
    const category = value.includes('MLS conversation state is unavailable') ? 'crypto-state-unavailable'
      : value.includes('An active local device is required') ? 'crypto-device-unavailable'
      : value.includes('Rejected call signaling event') ? 'signal-decryption-rejected'
      : /Failed to (send|flush) call signaling/.test(value) ? 'signal-send-failed'
      : null;
    if (category) record(category);
  });
}

export async function saveCallDiagnostics(testInfo, diagnostics) {
  await mkdir('test-results/call-diagnostics', { recursive: true });
  const scenario = testInfo.title.includes('delayed recipient') ? 'delayed' : 'normal';
  const path = `test-results/call-diagnostics/signaling-${scenario}-${testInfo.project.name}-${testInfo.retry}.json`;
  await writeFile(path, JSON.stringify({ status: testInfo.status, events: diagnostics }, null, 2));
  await testInfo.attach('Call signaling milestones', { path, contentType: 'application/json' });
}
