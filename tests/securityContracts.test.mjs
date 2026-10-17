import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const callProvider = await readFile(new URL('../src/context/calls/CallProvider.jsx', import.meta.url), 'utf8');
const callSignaling = await readFile(new URL('../src/context/calls/useCallSignaling.js', import.meta.url), 'utf8');
const callTransport = await readFile(new URL('../src/context/calls/useCallTransport.js', import.meta.url), 'utf8');
const callSources = [callProvider, callSignaling, callTransport].join('\n');
const migration = await readFile(new URL('../supabase/migrations/20260723114811_harden_messenger_security_and_limits.sql', import.meta.url), 'utf8');

test('call signaling uses only private chat-scoped topics', () => {
  assert.doesNotMatch(callSources, /call:user:/);
  assert.match(callSources, /call:chat:/);
  assert.match(callTransport, /call:chat:\$\{chat\.id\}:media/);
  assert.match(callSources, /private:\s*true/);
  assert.doesNotMatch(
    callSources,
    /const sendSignalingMessage[\s\S]*?channel\.subscribe[\s\S]*?const startCall/
  );
});

test('database migration locks routing and abuse boundaries', () => {
  assert.match(migration, /Message identity and routing fields are immutable/);
  assert.match(migration, /Message rate limit exceeded/);
  assert.match(migration, /file_size_limit = 15728640/);
  assert.match(migration, /drop column if exists encrypted_private_key/);
});
