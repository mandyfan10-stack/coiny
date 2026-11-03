// @ts-check
if (typeof window === 'undefined') {
  // Node (unit tests): expose Web Crypto under the browser global used below.
  /** @type {any} */ (globalThis).window = { crypto: globalThis.crypto };
}

/** @typedef {Error & { code?: string }} E2EEError */

/**
 * @typedef {object} Argon2idParameters
 * @property {number} memorySize
 * @property {number} iterations
 * @property {number} parallelism
 * @property {number} hashLength
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {string}
 */
function bufToHex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

/**
 * Strict hex decoding: rejects odd lengths and non-hex characters.
 * @param {unknown} hexString
 * @returns {Uint8Array<ArrayBuffer>}
 */
function hexToBuf(hexString) {
  if (typeof hexString !== 'string' || hexString.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hexString)) {
    throw new Error('Invalid hexadecimal crypto payload.');
  }
  const result = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    result[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
  }
  return result;
}

/**
 * 1. Generate an ECDH P-256 key pair.
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateE2EEKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 2. Export / import a public key as a JWK string.
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportPublicKey(key) {
  const jwk = await window.crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

/**
 * @param {string} jwkString
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

/**
 * 3. Export / import a private key as a JWK string.
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportPrivateKey(key) {
  const jwk = await window.crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

/**
 * @param {string} jwkString
 * @param {boolean} [extractable=true]
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(jwkString, extractable = true) {
  const jwk = JSON.parse(jwkString);
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    extractable,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 4. Derive an AES-GCM key from a password via PBKDF2 (legacy v1 backups).
 * @param {string} password
 * @param {Uint8Array<ArrayBuffer>} salt
 * @returns {Promise<CryptoKey>}
 */
async function derivePasswordKey(password, salt) {
  const passwordKeyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 600000,
      hash: 'SHA-256'
    },
    passwordKeyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/** @type {Readonly<Argon2idParameters>} */
const ARGON2ID_PARAMETERS = Object.freeze({
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32
});

/**
 * Argon2id key derivation with bounds-checked parameters (backups carry
 * their own parameters, so untrusted values must not exhaust memory).
 * @param {string} secret
 * @param {Uint8Array} salt
 * @param {Argon2idParameters} [parameters] runtime-validated; may come from a backup
 * @returns {Promise<CryptoKey>}
 */
async function deriveArgon2idKey(secret, salt, parameters = ARGON2ID_PARAMETERS) {
  if (
    typeof secret !== 'string' || secret.length < 1 || secret.length > 1024
    || !(salt instanceof Uint8Array) || salt.length !== 16
    || !Number.isInteger(parameters?.memorySize) || parameters.memorySize < 8192 || parameters.memorySize > 262144
    || !Number.isInteger(parameters?.iterations) || parameters.iterations < 1 || parameters.iterations > 10
    || !Number.isInteger(parameters?.parallelism) || parameters.parallelism < 1 || parameters.parallelism > 4
    || parameters?.hashLength !== 32
  ) {
    throw new Error('Unsafe Argon2id parameters.');
  }
  const { argon2id } = await import('hash-wasm');
  const rawKey = await argon2id({
    password: secret,
    salt,
    parallelism: parameters.parallelism,
    iterations: parameters.iterations,
    memorySize: parameters.memorySize,
    hashLength: parameters.hashLength,
    outputType: 'binary'
  });
  // hash-wasm returns a fresh, non-shared buffer.
  const keyBytes = /** @type {Uint8Array<ArrayBuffer>} */ (rawKey);
  return window.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * @param {Uint8Array<ArrayBuffer>} rawJwk
 * @param {string} secret
 */
async function createArgon2idEnvelope(rawJwk, secret) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveArgon2idKey(secret, salt);
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rawJwk);
  return {
    kdf: 'argon2id',
    parameters: ARGON2ID_PARAMETERS,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    ciphertext: bufToHex(ciphertext)
  };
}

/**
 * 4.5 Generate a 24-character recovery code in groups of four.
 * @returns {string}
 */
export function generateRecoveryCode() {
  const chars = 'ABCDEFGHJKMNPQRSTVWXYZ2345678901';
  const array = new Uint8Array(24);
  window.crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < 24; i++) {
    if (i > 0 && i % 4 === 0) {
      result += '-';
    }
    const val = array[i] & 31;
    result += chars[val];
  }
  return result;
}

/**
 * 5. Encrypt the private key for cloud backup (password + recovery code envelopes).
 * @param {CryptoKey} privateKey
 * @param {string} password
 * @param {string} recoveryCode
 * @returns {Promise<string>} backup JSON
 */
export async function backupPrivateKey(privateKey, password, recoveryCode) {
  const privateKeyJwk = await exportPrivateKey(privateKey);
  const rawJwk = encoder.encode(privateKeyJwk);
  const cleanRecoveryCode = recoveryCode.replace(/-/g, '').toUpperCase();
  return JSON.stringify({
    version: 2,
    password_backup: await createArgon2idEnvelope(rawJwk, password),
    recovery_backup: await createArgon2idEnvelope(rawJwk, cleanRecoveryCode)
  });
}

/**
 * 6. Decrypt a private key backup (v2 Argon2id, or legacy PBKDF2 formats).
 * @param {string} backupJsonString
 * @param {string} secret password, or recovery code when `isRecovery`
 * @param {boolean} [isRecovery=false]
 * @returns {Promise<CryptoKey>}
 */
export async function restorePrivateKey(backupJsonString, secret, isRecovery = false) {
  if (typeof backupJsonString !== 'string' || backupJsonString.length > 1048576 || typeof secret !== 'string') {
    throw new Error('Invalid recovery backup input.');
  }
  const backup = JSON.parse(backupJsonString);

  if (backup.version === 2) {
    const target = isRecovery ? backup.recovery_backup : backup.password_backup;
    if (!target || target.kdf !== 'argon2id' || !target.parameters) {
      throw new Error('Invalid Argon2id recovery backup.');
    }
    if (
      typeof target.salt !== 'string' || target.salt.length !== 32
      || typeof target.iv !== 'string' || target.iv.length !== 24
      || typeof target.ciphertext !== 'string' || target.ciphertext.length < 32 || target.ciphertext.length > 2097152
    ) {
      throw new Error('Invalid Argon2id recovery envelope.');
    }
    const cleanSecret = isRecovery ? secret.replace(/-/g, '').toUpperCase() : secret;
    const key = await deriveArgon2idKey(cleanSecret, hexToBuf(target.salt), target.parameters);
    const plaintext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBuf(target.iv) },
      key,
      hexToBuf(target.ciphertext)
    );
    return importPrivateKey(decoder.decode(plaintext));
  }

  // Backward compatibility: check if it's the old single-backup format
  if (backup.ciphertext && backup.salt && backup.iv) {
    if (isRecovery) {
      throw new Error("Восстановление по коду недоступно для старых аккаунтов. Пожалуйста, используйте ваш пароль.");
    }
    const ciphertext = hexToBuf(backup.ciphertext);
    const salt = hexToBuf(backup.salt);
    const iv = hexToBuf(backup.iv);

    const aesKey = await derivePasswordKey(secret, salt);
    const decryptedContent = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      aesKey,
      ciphertext
    );
    const jwkString = decoder.decode(decryptedContent);
    return await importPrivateKey(jwkString);
  }

  // Dual-backup format
  const targetBackup = isRecovery ? backup.recovery_backup : backup.password_backup;
  if (!targetBackup) {
    throw new Error("Неверный формат резервной копии ключей.");
  }

  const ciphertext = hexToBuf(targetBackup.ciphertext);
  const salt = hexToBuf(targetBackup.salt);
  const iv = hexToBuf(targetBackup.iv);

  const cleanSecret = isRecovery ? secret.replace(/-/g, '').toUpperCase() : secret;
  const aesKey = await derivePasswordKey(cleanSecret, salt);
  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    aesKey,
    ciphertext
  );

  const jwkString = decoder.decode(decryptedContent);
  return await importPrivateKey(jwkString);
}

/**
 * 7. Derive the shared, non-extractable AES-GCM key (ECDH).
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} otherPublicKey
 * @returns {Promise<CryptoKey>}
 */
export async function deriveSymmetricKey(privateKey, otherPublicKey) {
  return await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: otherPublicKey
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false, // extractable (disabled for security)
    ['encrypt', 'decrypt']
  );
}

/**
 * 8. Encrypt a text message.
 * @param {string} plaintext
 * @param {CryptoKey} aesKey
 * @returns {Promise<{ ciphertext: string, iv: string }>} hex-encoded
 */
export async function encryptMessage(plaintext, aesKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedContent = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    aesKey,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bufToHex(encryptedContent),
    iv: bufToHex(iv)
  };
}

/**
 * 9. Decrypt a text message.
 * @param {string} ciphertextHex
 * @param {string} ivHex
 * @param {CryptoKey} aesKey
 * @returns {Promise<string>}
 */
export async function decryptMessage(ciphertextHex, ivHex, aesKey) {
  const ciphertext = hexToBuf(ciphertextHex);
  const iv = hexToBuf(ivHex);

  const decryptedContent = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    aesKey,
    ciphertext
  );

  return decoder.decode(decryptedContent);
}

/**
 * 10. Encrypt a file; the 12-byte IV is prepended to the ciphertext.
 * @param {Blob} fileBlob
 * @param {CryptoKey} aesKey
 * @returns {Promise<Blob>} `application/octet-stream`
 */
export async function encryptFile(fileBlob, aesKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const arrayBuffer = await fileBlob.arrayBuffer();
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    aesKey,
    arrayBuffer
  );

  // Combine IV and ciphertext into a single binary blob
  const resultBuffer = new Uint8Array(iv.length + encryptedContent.byteLength);
  resultBuffer.set(iv, 0);
  resultBuffer.set(new Uint8Array(encryptedContent), iv.length);
  return new Blob([resultBuffer], { type: 'application/octet-stream' });
}

/**
 * Upload guard: returns the key, or throws `E2EE_KEY_UNAVAILABLE` so callers
 * can never fall back to uploading plaintext.
 * @param {CryptoKey | null | undefined} aesKey
 * @returns {CryptoKey}
 */
export function requireE2EEKey(aesKey) {
  if (!aesKey) {
    /** @type {E2EEError} */
    const error = new Error('Ключ сквозного шифрования недоступен. Повторите попытку после синхронизации ключей.');
    error.code = 'E2EE_KEY_UNAVAILABLE';
    throw error;
  }
  return aesKey;
}

/**
 * Encrypt an attachment for upload; failures never fall back to plaintext.
 * @param {Blob} fileBlob
 * @param {CryptoKey | null | undefined} aesKey
 * @returns {Promise<Blob>}
 */
export async function encryptFileForE2EE(fileBlob, aesKey) {
  try {
    return await encryptFile(fileBlob, requireE2EEKey(aesKey));
  } catch (cause) {
    if (/** @type {E2EEError} */ (cause)?.code === 'E2EE_KEY_UNAVAILABLE') throw cause;
    /** @type {E2EEError} */
    const error = new Error('Не удалось зашифровать вложение. Файл не был загружен.', { cause });
    error.code = 'E2EE_ENCRYPTION_FAILED';
    throw error;
  }
}

/**
 * 11. Decrypt a file produced by `encryptFile`.
 * @param {Blob} encryptedBlob
 * @param {CryptoKey} aesKey
 * @param {string} [outputType] MIME type of the restored blob
 * @returns {Promise<Blob>}
 */
export async function decryptFile(encryptedBlob, aesKey, outputType = '') {
  const arrayBuffer = await encryptedBlob.arrayBuffer();
  const iv = new Uint8Array(arrayBuffer, 0, 12);
  const ciphertext = new Uint8Array(arrayBuffer, 12);
  const decryptedContent = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    aesKey,
    ciphertext
  );
  return new Blob([decryptedContent], outputType ? { type: outputType } : undefined);
}

