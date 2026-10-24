import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chatService = await readFile(new URL('../src/services/chatService.js', import.meta.url), 'utf8');
const drawer = await readFile(new URL('../src/components/MainMenuDrawer.jsx', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20261024091714_fix_saved_messages_membership.sql', import.meta.url),
  'utf8'
);

test('saved messages creation is atomic and uses supported member roles', () => {
  assert.doesNotMatch(chatService, /role:\s*['"]owner['"]/);
  assert.match(chatService, /\.rpc\('ensure_saved_messages_chat'\)/);
  assert.doesNotMatch(drawer, /\.rpc\(/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /values \(saved_chat_id, caller_id, 'member'\)/);
  assert.match(migration, /on conflict \(chat_id, profile_id\) do nothing/);
  assert.doesNotMatch(migration, /do update|delete from|drop table/i);

  assert.match(migration, /security invoker/);
});