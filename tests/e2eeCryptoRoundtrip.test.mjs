import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateE2EEKeyPair,
  exportPublicKey,
  importPublicKey,
  backupPrivateKey,
  restorePrivateKey,
  deriveSymmetricKey,
  encryptMessage,
  decryptMessage,
  encryptFile,
  encryptFileForE2EE,
  requireE2EEKey,
  decryptFile,
} from '../src/utils/e2eeHelper.js';
import { getAttachmentMimeType, getPrivateAttachmentPath } from '../src/utils/storageMedia.js';

// End-to-end crypto round trips (formerly the standalone testE2EE.js runner).

async function derivePair() {
  const alice = await generateE2EEKeyPair();
  const bob = await generateE2EEKeyPair();
  const alicePublic = await importPublicKey(await exportPublicKey(alice.publicKey));
  const bobPublic = await importPublicKey(await exportPublicKey(bob.publicKey));
  return {
    alice,
    bob,
    aliceShared: await deriveSymmetricKey(alice.privateKey, bobPublic),
    bobShared: await deriveSymmetricKey(bob.privateKey, alicePublic),
  };
}

test('private attachment paths are extracted, public media bypasses them', () => {
  assert.equal(
    getPrivateAttachmentPath('storage://chat-attachments/chat/user/file%20name.png'),
    'chat/user/file name.png',
  );
  assert.equal(
    getPrivateAttachmentPath('https://example.supabase.co/storage/v1/object/public/public-media/user/story.png'),
    null,
  );
  assert.equal(getAttachmentMimeType('https://example.test/file.webp'), 'image/webp');
});

test('public keys survive export and import', async () => {
  const { publicKey } = await generateE2EEKeyPair();
  const exported = await exportPublicKey(publicKey);
  assert.equal(typeof exported, 'string');
  assert.ok(await importPublicKey(exported));
});

test('private key backup restores with both the password and the recovery code', async () => {
  const { privateKey } = await generateE2EEKeyPair();
  const password = 'secure-e2ee-password-123!';
  const recoveryCode = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX';
  const backup = await backupPrivateKey(privateKey, password, recoveryCode);
  assert.equal(typeof backup, 'string');
  assert.ok(await restorePrivateKey(backup, password, false));
  assert.ok(await restorePrivateKey(backup, recoveryCode, true));
});

test('ECDH-derived shared keys are non-extractable and interoperate', async () => {
  const { aliceShared, bobShared } = await derivePair();
  assert.equal(aliceShared.extractable, false);
  const plaintext = 'Hello Bob! This is an E2EE encrypted message on CoinGram.';
  const encrypted = await encryptMessage(plaintext, aliceShared);
  assert.ok(encrypted.ciphertext && encrypted.iv);
  assert.equal(await decryptMessage(encrypted.ciphertext, encrypted.iv, bobShared), plaintext);
});

test('files round-trip through encryption with their media type restored', async () => {
  const { aliceShared, bobShared } = await derivePair();
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 100, 200]);
  const file = new Blob([bytes], { type: 'image/png' });

  const encrypted = await encryptFile(file, aliceShared);
  assert.ok(encrypted.size > file.size, 'ciphertext carries the IV and auth tag');

  const decrypted = await decryptFile(encrypted, bobShared, file.type);
  assert.equal(decrypted.type, 'image/png');
  assert.deepEqual(new Uint8Array(await decrypted.arrayBuffer()), bytes);
});

test('E2EE upload guard refuses a missing key and encrypts with an available one', async () => {
  const { aliceShared } = await derivePair();
  const file = new Blob([new Uint8Array([7, 7, 7])], { type: 'image/png' });

  await assert.rejects(encryptFileForE2EE(file, null), { code: 'E2EE_KEY_UNAVAILABLE' });
  assert.equal(requireE2EEKey(aliceShared), aliceShared);
  assert.equal((await encryptFileForE2EE(file, aliceShared)).type, 'application/octet-stream');
});
