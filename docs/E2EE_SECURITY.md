# E2EE security model and upgrade boundary

Coiny currently encrypts message and media payloads with an AES-GCM-256 key
derived from each participants' long-lived ECDH P-256 keys. Public keys are
published in the profile. New private-key backups use Argon2id (64 MiB, three
iterations, parallelism one) and AES-GCM with a user secret. Legacy PBKDF2-SHA-256
backups (600,000 iterations) remain readable.

This protocol applies to personal conversations, excluding verified notes-to-self.
Group/channel messages do not use this E2EE path. The MLS/v2 code remains behind
an off-by-default feature flag and requires pinned runtime artifacts and audit
approval before it can be described as the production protocol.

## What this protects

- The Supabase message row and private attachment storage receive ciphertext,
  not the plaintext payload.
- AES-GCM authenticates the ciphertext and its IV; altered ciphertext fails to
  decrypt.
- Safety Numbers let participants compare the currently published public keys
  out of band.

## Important limitation: no forward secrecy yet

This is a static-key ECDH design. Compromise of a participant's private key can
allow an attacker who has retained past ciphertext to derive historic shared
keys. It is therefore **not** a Signal-style Double Ratchet protocol and must
not be described as providing forward secrecy or post-compromise security.

The client now preserves imported local private keys as non-extractable
`CryptoKey` objects when restoring its cached JWK. This reduces exposure within
the browser process but does not change the protocol limitation above.

## Safe path to forward secrecy

Forward secrecy requires a versioned protocol migration, not a drop-in key
derivation change. A future implementation must provide all of the following:

1. Per-device identity keys plus signed prekeys and one-time prekeys, with
   server-side publication, consumption, rotation, and device revocation.
2. An authenticated session bootstrap (for example X3DH) that validates the
   remote identity and prekey signatures before sending any message.
3. A Double Ratchet state for every device pair, persisted locally with atomic
   send/receive counters, skipped-message keys, and rollback protection.
4. A versioned message envelope that routes ciphertext to every recipient
   device; static-ECDH messages must remain readable during migration.
5. UX for identity changes and Safety Number verification, plus exhaustive
   test vectors, multi-device concurrency testing, and an external security
   review before claiming forward secrecy.

Until that migration is complete, the static ECDH implementation remains the
supported compatibility protocol.
