import { mkdir, writeFile } from 'node:fs/promises';

// Record protocol milestones only. Never retain payloads, chat/user IDs, URLs,
// tokens, passwords, encrypted envelopes, or arbitrary console text.
export function observeCallSignaling(page, label, diagnostics, startedAt) {
  const record = (kind, details = {}) => {
    if (diagnostics.length < 500) diagnostics.push({ peer: label, ms: Date.now() - startedAt, kind, ...details });
  };
  const events = new Set(['incoming-call', 'call-received', 'call-accepted', 'call-rejected', 'signal', 'hangup']);
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/realtime/')) return;
    record('socket-open');
    socket.on('close', () => record('socket-close'));
    for (const [hook, direction] of [['framesent', 'sent'], ['framereceived', 'received']]) {
      socket.on(hook, ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          const [, , topic, event, body] = Array.isArray(frame)
            ? frame : [null, null, frame.topic, frame.event, frame.payload];
          if (!String(topic).startsWith('realtime:call:chat:')) return;
          const channel = String(topic).endsWith(':media') ? 'media' : 'invitation';
          if (['phx_join', 'phx_reply', 'phx_error', 'phx_close'].includes(event)) {
            const status = ['ok', 'error'].includes(body?.status) ? body.status : undefined;
            record(event, { direction, channel, ...(status ? { status } : {}) });
          } else if (event === 'broadcast' && events.has(body?.event)) {
            record(body.event, { direction, channel, encrypted: body?.payload?.e2ee === 2 });
          }
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
  const path = `test-results/call-diagnostics/signaling-${testInfo.project.name}-${testInfo.retry}.json`;
  await writeFile(path, JSON.stringify({ status: testInfo.status, events: diagnostics }, null, 2));
  await testInfo.attach('Call signaling milestones', { path, contentType: 'application/json' });
}
