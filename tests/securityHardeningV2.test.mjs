import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeExternalHttpsUrl, createStorageReference, getStorageObjectPath } from '../src/utils/urlSecurity.js';
import { decryptMediaV2, encryptMediaV2 } from '../src/crypto/e2eeMediaV2.ts';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('external links and storage paths reject active content and traversal', () => {
  assert.equal(normalizeExternalHttpsUrl('javascript:alert(1)'), null);
  assert.equal(normalizeExternalHttpsUrl('file:///etc/passwd'), null);
  assert.equal(normalizeExternalHttpsUrl('http://example.com'), null);
  assert.equal(normalizeExternalHttpsUrl('https://user:pass@example.com'), null);
  assert.equal(normalizeExternalHttpsUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(createStorageReference('chat-attachments', '../secret'), null);
  assert.equal(getStorageObjectPath('storage://chat-attachments/a/%252e%252e/b', 'chat-attachments'), null);
  assert.equal(getStorageObjectPath('storage://other/a/b', 'chat-attachments'), null);
  assert.equal(getStorageObjectPath('https://other.supabase.co/storage/v1/object/public/chat-attachments/a/b', 'chat-attachments'), null);
  assert.equal(
    getStorageObjectPath('https://evil.example/storage/v1/object/public/chat-attachments/a/b', 'chat-attachments', 'https://project.supabase.co'),
    null
  );
});

test('v2 media uses independent content keys and detects tampering', async () => {
  const original = new Blob([new TextEncoder().encode('media payload')], { type: 'image/webp' });
  const first = await encryptMediaV2(original);
  const second = await encryptMediaV2(original);
  assert.notEqual(first.metadata.contentKey, second.metadata.contentKey);
  assert.notEqual(first.metadata.iv, second.metadata.iv);
  assert.equal((await decryptMediaV2(first.blob, first.metadata)).size, original.size);
  const tampered = new Uint8Array(await first.blob.arrayBuffer());
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(() => decryptMediaV2(new Blob([tampered]), first.metadata));
});

test('Electron source enforces app protocol, navigation, permission and fuse boundaries', async () => {
  const [main, fuses, csp] = await Promise.all([
    read('electron-main.cjs'),
    read('scripts/apply-electron-fuses.cjs'),
    read('index.html')
  ]);
  assert.match(main, /const APP_ORIGIN = `\$\{APP_SCHEME\}:\/\/\$\{APP_HOST\}`/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /return \{ action: 'deny' \}/);
  assert.match(main, /details\?\.isMainFrame === true/);
  assert.match(main, /details\?\.userGesture === true/);
  assert.match(main, /request\.frame === mainWindow\.webContents\.mainFrame/);
  assert.doesNotMatch(main, /sources\[0\]/);
  assert.match(fuses, /RunAsNode\]: false/);
  assert.match(fuses, /EnableEmbeddedAsarIntegrityValidation\]: true/);
  assert.match(fuses, /OnlyLoadAppFromAsar\]: true/);
  assert.match(fuses, /GrantFileProtocolExtraPrivileges\]: false/);
  assert.match(fuses, /strictlyRequireAllFuses: true/);
  assert.match(csp, /content="__COINY_CSP__"/);
  const vite = await read('vite.config.js');
  assert.match(vite, /"script-src 'self' 'wasm-unsafe-eval'"/);
  assert.match(vite, /"object-src 'none'"/);
  assert.match(vite, /"frame-src 'none'"/);
  assert.match(vite, /"base-uri 'self'"/);
  assert.match(vite, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(vite, /font-src 'self' data: https:\/\/fonts\.gstatic\.com/);
  assert.match(vite, /const metaCsp/);
  assert.match(vite, /const headerCsp/);
  assert.match(vite, /"frame-ancestors 'none'"/);
  assert.doesNotMatch(vite, /const metaCsp = \[[^\]]*"frame-ancestors/);
  assert.doesNotMatch(vite, /connect-src 'self' https:/);
  assert.match(vite, /OPENMLS_WASM_SHA256/);
  assert.match(vite, /E2EE_V2_AUDIT_REPORT_SHA256/);
  assert.match(vite, /E2EE v2 is fail-closed/);
});

test('E2EE v2 migration is append-only, fail-closed and atomically claims KeyPackages', async () => {
  const migration = await read('supabase/migrations/20260808194137_e2ee_v2_security_foundation.sql');
  for (const table of [
    'e2ee_identities', 'e2ee_recovery_backups', 'user_devices', 'e2ee_key_packages',
    'e2ee_conversations', 'e2ee_handshake_events', 'e2ee_welcomes', 'device_transfers'
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /for update of kp skip locked/i);
  assert.match(migration, /crypto_version = 2[\s\S]+text is null[\s\S]+media is null/i);
  assert.match(migration, /MLS messages are append-only/);
  assert.match(migration, /Unknown, foreign, or revoked sender device/);
  assert.match(migration, /This conversation requires E2EE v2/);
  assert.match(migration, /security invoker set search_path = ''/i);
  assert.match(migration, /on realtime\.messages for select to authenticated/);
  assert.match(migration, /typing:chat:/);
  assert.match(migration, /call:chat:/);
});

test('E2EE v2 activation inserts conversation and initial commit atomically', async () => {
  const [migration, service] = await Promise.all([
    read('supabase/migrations/20260809083640_atomic_e2ee_v2_conversation_activation.sql'),
    read('src/services/e2eeV2Service.ts')
  ]);
  assert.match(migration, /create or replace function private\.activate_e2ee_conversation/);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /from public\.chat_members[\s\S]+member\.profile_id = actor/);
  assert.match(migration, /from public\.user_devices[\s\S]+device\.user_id = actor[\s\S]+device\.status = 'active'/);
  assert.match(migration, /insert into public\.e2ee_conversations[\s\S]+insert into public\.e2ee_handshake_events/);
  assert.match(migration, /create or replace function public\.activate_e2ee_conversation[\s\S]+security invoker[\s\S]+set search_path = ''/i);
  assert.match(migration, /revoke execute[\s\S]+from public, anon/);
  assert.match(service, /\.rpc\('activate_e2ee_conversation'/);
  assert.doesNotMatch(service, /from\('e2ee_conversations'\)\.insert/);
});

test('Android backup cannot export WebView E2EE and offline queue state', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /android:allowBackup="true"/);
});

test('offline syncing is single-flight, session-scoped, and preserves newly queued items', async () => {
  const sync = await read('src/context/chat/useOfflineSync.js');
  assert.match(sync, /if \(syncPromiseRef\.current\)[\s\S]+return syncPromiseRef\.current/);
  assert.match(sync, /sessionRef\.current\.generation === session\.generation/);
  assert.match(sync, /if \(!isCurrentSession\(\)\) break/);
  assert.match(sync, /prev\.filter\(\(q\) => q\.queueId !== item\.queueId\)/);
  assert.match(sync, /queueOwnerId !== \(currentUser\?\.id \?\? null\)/);
});

test('image and sticker Edge Functions enforce content validation and bounded processing', async () => {
  const [images, stickers, origins] = await Promise.all([
    read('supabase/functions/sanitize-public-image/index.ts'),
    read('supabase/functions/import-sticker-pack/index.ts'),
    read('supabase/functions/_shared/appOrigins.ts')
  ]);
  assert.match(images, /detectedMime/);
  assert.match(images, /MAX_PIXELS/);
  assert.match(images, /MAX_DECOMPRESSION_RATIO/);
  assert.match(images, /image\.strip\(\)/);
  assert.match(images, /MagickFormat\.WebP/);
  assert.match(images, /file instanceof Blob/);
  assert.match(origins, /mandyfan10-stack\.github\.io/);
  assert.match(stickers, /MAX_STICKERS/);
  assert.match(stickers, /AbortSignal\.timeout/);
  assert.match(stickers, /MAX_DECOMPRESSION_RATIO/);
  assert.match(stickers, /isWebP/);
  assert.match(stickers, /isWebM/);
  assert.match(stickers, /validateLottie/);
  assert.doesNotMatch(stickers, /console\.(?:log|warn|error)\([^\n]*downloadUrl/);
});

test('call hardening binds MLS signaling and fully disposable DSP', async () => {
  const [secureChannel, dsp, ice] = await Promise.all([
    read('src/context/calls/secureCallChannel.js'),
    read('src/context/calls/voiceEnhancement.js'),
    read('src/context/calls/iceServers.ts')
  ]);
  assert.match(secureChannel, /call-signal/);
  assert.match(secureChannel, /Replayed call signaling event/);
  assert.match(secureChannel, /DTLS fingerprint binding mismatch/);
  assert.match(dsp, /frequency: 80/);
  assert.match(dsp, /DynamicsCompressorNode/);
  assert.match(dsp, /AudioWorkletNode/);
  assert.match(dsp, /replaceTrack/);
  assert.match(dsp, /resource.context.close\(\)/);
  assert.match(dsp, /echoCancellation: true/);
  assert.match(ice, /iceTransportPolicy: hasRelay && !options\.allowDirectConnection \? 'relay' : 'all'/);
  assert.match(ice, /STUN_SERVERS/);
  assert.match(ice, /turn-credentials/);
});

test('logout cleanup and the v1 compatibility boundary remain explicit', async () => {
  const [auth, dataLayer, v1Adapter, messageService] = await Promise.all([
    read('src/context/AuthContext.jsx'),
    read('src/services/dataLayer.js'),
    read('src/services/v1MessageCompatibilityAdapter.js'),
    read('src/services/messageService.js')
  ]);
  assert.match(auth, /await dataService\.signOut\(\);[\s\S]+await clearLocalAppData\(\)/);
  assert.match(v1Adapter, /Legacy positional API/);
  assert.match(dataLayer, /v1MessageCompatibilityAdapter\.sendMessage/);
  assert.match(messageService, /Public v2 API/);
  assert.doesNotMatch(messageService, /messageOrChatId/);
});
