import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  generateE2EEKeyPair,
  exportPublicKey,
  importPublicKey,
  exportPrivateKey,
  importPrivateKey,
  generateRecoveryCode,
  backupPrivateKey,
  restorePrivateKey,
  deriveSymmetricKey,
  encryptMessage,
  decryptMessage,
  encryptFileForE2EE,
  decryptFile
} from '../src/utils/e2eeHelper.js';

const chatInfo = readFileSync(new URL('../src/components/ChatInfo.jsx', import.meta.url), 'utf8');
const e2eeTab = readFileSync(new URL('../src/components/settings/E2EETab.jsx', import.meta.url), 'utf8');
const e2eeContext = readFileSync(new URL('../src/context/E2EEContext.jsx', import.meta.url), 'utf8');

test('wrong password cannot restore E2EE private key backup', async () => {
  const keys = await generateE2EEKeyPair();
  const backup = await backupPrivateKey(keys.privateKey, 'Correct#Password1', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
  await assert.rejects(
    () => restorePrivateKey(backup, 'Wrong#Password1', false),
    /./,
    'restore with wrong password must reject'
  );
});

test('wrong recovery code cannot restore E2EE private key backup', async () => {
  const keys = await generateE2EEKeyPair();
  const backup = await backupPrivateKey(keys.privateKey, 'Correct#Password1', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
  await assert.rejects(
    () => restorePrivateKey(backup, 'ZZZZ-YYYY-XXXX-WWWW-VVVV-UUUU', true),
    /./,
    'restore with wrong recovery code must reject'
  );
});

test('untrusted Argon2id parameters are rejected before expensive derivation', async () => {
  const keys = await generateE2EEKeyPair();
  const backup = JSON.parse(await backupPrivateKey(
    keys.privateKey,
    'Correct#Password1',
    'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'
  ));
  backup.password_backup.parameters.memorySize = 2 ** 30;
  await assert.rejects(
    () => restorePrivateKey(JSON.stringify(backup), 'Correct#Password1', false),
    /Unsafe Argon2id parameters/
  );
});

test('message decrypt after key re-derivation (reload simulation)', async () => {
  const alice = await generateE2EEKeyPair();
  const bob = await generateE2EEKeyPair();
  const bobPub = await importPublicKey(await exportPublicKey(bob.publicKey));

  const aliceShared = await deriveSymmetricKey(alice.privateKey, bobPub);
  const encrypted = await encryptMessage('reload-safe plaintext', aliceShared);

  // Simulate reload: re-import public key and re-derive
  const bobPubAgain = await importPublicKey(await exportPublicKey(bob.publicKey));
  const aliceSharedAfterReload = await deriveSymmetricKey(alice.privateKey, bobPubAgain);
  const decrypted = await decryptMessage(
    encrypted.ciphertext,
    encrypted.iv,
    aliceSharedAfterReload
  );
  assert.equal(decrypted, 'reload-safe plaintext');
});

test('media blob decrypt round-trip after re-derive', async () => {
  const alice = await generateE2EEKeyPair();
  const bob = await generateE2EEKeyPair();
  const bobPublic = await importPublicKey(await exportPublicKey(bob.publicKey));
  const shared = await deriveSymmetricKey(alice.privateKey, bobPublic);

  const bytes = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const original = new Blob([bytes], { type: 'image/png' });
  const encrypted = await encryptFileForE2EE(original, shared);

  const alicePublic = await importPublicKey(await exportPublicKey(alice.publicKey));
  const bobShared = await deriveSymmetricKey(bob.privateKey, alicePublic);
  const decrypted = await decryptFile(encrypted, bobShared, 'image/png');
  const out = new Uint8Array(await decrypted.arrayBuffer());
  assert.deepEqual([...out], [...bytes]);
  assert.equal(decrypted.type, 'image/png');
});

test('UI exposes Safety Number and public key fingerprint surfaces', () => {
  assert.match(chatInfo, /computeSafetyNumber/);
  assert.match(chatInfo, /Код безопасности \(Safety Number\)/);
  assert.match(chatInfo, /safetyNumber/);
  assert.match(e2eeTab, /settings-fingerprint/);
  assert.match(e2eeTab, /public_key/);
});

test('E2EE context persists and restores private key path', () => {
  assert.match(e2eeContext, /saveE2EEBackup|getE2EEBackup/);
  assert.match(e2eeContext, /backupPrivateKey|restorePrivateKey/);
});

test('importPrivateKey honors extractable parameter and rejects export when extractable is false', async () => {
  const keys = await generateE2EEKeyPair();
  const jwkString = await exportPrivateKey(keys.privateKey);

  const extractableKey = await importPrivateKey(jwkString, true);
  assert.equal(extractableKey.extractable, true, 'key imported with extractable=true must be extractable');

  const nonExtractableKey = await importPrivateKey(jwkString, false);
  assert.equal(nonExtractableKey.extractable, false, 'key imported with extractable=false must be non-extractable');

  await assert.rejects(
    () => window.crypto.subtle.exportKey('jwk', nonExtractableKey),
    (err) => err?.name === 'OperationError' || /OperationError|extractable/i.test(err?.message || ''),
    'exporting non-extractable private key via exportKey must throw OperationError'
  );
});
test('derivePasswordKey uses 600,000 iterations for PBKDF2 derivation', () => {
  const e2eeHelperCode = readFileSync(new URL('../src/utils/e2eeHelper.js', import.meta.url), 'utf8');
  assert.match(e2eeHelperCode, /iterations:\s*600000/, 'PBKDF2 derivation must use iterations: 600000');
  assert.match(e2eeHelperCode, /name:\s*'PBKDF2'/, 'PBKDF2 key derivation must specify PBKDF2 algorithm');
});

test('corrupting AES-GCM ciphertext or IV causes decryptMessage and decryptFile to reject with authentication error', async () => {
  const alice = await generateE2EEKeyPair();
  const bob = await generateE2EEKeyPair();
  const bobPub = await importPublicKey(await exportPublicKey(bob.publicKey));
  const sharedKey = await deriveSymmetricKey(alice.privateKey, bobPub);

  const message = 'Authenticated sensitive message payload';
  const encryptedMsg = await encryptMessage(message, sharedKey);

  // 1. Corrupt ciphertext in decryptMessage
  const badCiphertext = encryptedMsg.ciphertext.slice(0, -2) + (encryptedMsg.ciphertext.slice(-2) === '00' ? '11' : '00');
  await assert.rejects(
    () => decryptMessage(badCiphertext, encryptedMsg.iv, sharedKey),
    (err) => err?.name === 'OperationError' || /OperationError|operation failed|cipher/i.test(err?.message || ''),
    'decryptMessage with corrupted ciphertext must reject with WebCrypto authentication error'
  );

  // 2. Corrupt IV in decryptMessage
  const badIv = encryptedMsg.iv.slice(0, -2) + (encryptedMsg.iv.slice(-2) === '00' ? '11' : '00');
  await assert.rejects(
    () => decryptMessage(encryptedMsg.ciphertext, badIv, sharedKey),
    (err) => err?.name === 'OperationError' || /OperationError|operation failed|cipher/i.test(err?.message || ''),
    'decryptMessage with corrupted IV must reject with WebCrypto authentication error'
  );

  // 3. Corrupt file ciphertext and IV in decryptFile
  const originalBlob = new Blob([new Uint8Array([10, 20, 30, 40, 50, 60])], { type: 'application/octet-stream' });
  const encryptedBlob = await encryptFileForE2EE(originalBlob, sharedKey);
  const blobBuf = new Uint8Array(await encryptedBlob.arrayBuffer());

  // Corrupt a byte in IV section (first 12 bytes)
  const tamperedIvBuf = new Uint8Array(blobBuf);
  tamperedIvBuf[0] ^= 0xff;
  const tamperedIvBlob = new Blob([tamperedIvBuf]);
  await assert.rejects(
    () => decryptFile(tamperedIvBlob, sharedKey),
    (err) => err?.name === 'OperationError' || /OperationError|operation failed|cipher/i.test(err?.message || ''),
    'decryptFile with corrupted IV byte must reject with WebCrypto authentication error'
  );

  // Corrupt a byte in Ciphertext section (after byte 12)
  const tamperedCipherBuf = new Uint8Array(blobBuf);
  tamperedCipherBuf[15] ^= 0xff;
  const tamperedCipherBlob = new Blob([tamperedCipherBuf]);
  await assert.rejects(
    () => decryptFile(tamperedCipherBlob, sharedKey),
    (err) => err?.name === 'OperationError' || /OperationError|operation failed|cipher/i.test(err?.message || ''),
    'decryptFile with corrupted Ciphertext byte must reject with WebCrypto authentication error'
  );
});

test('generateRecoveryCode uses 32-char Base32 and bitwise mask without undefined', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateRecoveryCode();
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.doesNotMatch(code, /undefined/);
  }
});

test('ChatInfo computeSafetyNumber uses view.getUint32 across all 5 segments', () => {
  assert.match(chatInfo, /getUint32\(0\)/);
  assert.match(chatInfo, /getUint32\(4\)/);
  assert.match(chatInfo, /getUint32\(8\)/);
  assert.match(chatInfo, /getUint32\(12\)/);
  assert.match(chatInfo, /getUint32\(16\)/);
  assert.doesNotMatch(chatInfo, /getInt32/);
});
