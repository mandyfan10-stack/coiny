import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../supabase/functions/cleanup-orphaned-media/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const uuid = number => `b7100000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const chat = uuid(1);
const user = uuid(2);
const old = new Date(Date.now() - 30 * 86400_000).toISOString();
const recent = new Date().toISOString();
const object = (bucket, path, created_at = old) => ({ bucket, path, created_at });
const messagePath = id => `${chat}/${user}/msg_${id}.jpg`;

function fixture({ tables = {}, files = [], rowCap = 500, storageCap = 500,
  failTable, repeatTable, nullTable, failBucket, authorized = true } = {}) {
  const removed = [];
  const queries = [];
  const listCalls = [];
  let handler;
  const client = {
    rpc: async () => ({ data: authorized, error: null }),
    from(table) {
      let cursor = '';
      let limit = 500;
      const query = {
        select: () => query,
        order: () => query,
        limit: value => { limit = value; return query; },
        gt: (_field, value) => { cursor = value; return query; },
        then(resolve, reject) {
          queries.push({ table, cursor });
          const rows = [...(tables[table] || [])].sort((a, b) => a.id < b.id ? -1 : 1)
            .filter(row => repeatTable === table || row.id > cursor)
            .slice(0, Math.min(limit, rowCap));
          const result = table === failTable && cursor
            ? { data: null, error: new Error('Synthetic page failure') }
            : { data: table === nullTable ? null : rows, error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async list(prefix, { limit, offset }) {
            listCalls.push({ bucket, prefix, offset });
            if (bucket === failBucket) return { data: null, error: new Error('Synthetic storage failure') };
            const entries = new Map();
            for (const file of files.filter(file => file.bucket === bucket)) {
              const start = prefix ? `${prefix}/` : '';
              if (!file.path.startsWith(start)) continue;
              const relative = file.path.slice(start.length);
              if (relative.includes('/')) entries.set(relative.split('/')[0], { name: relative.split('/')[0] });
              else entries.set(relative, { name: relative, id: file.path, metadata: { size: 10 }, created_at: file.created_at });
            }
            const sorted = [...entries.values()].sort((a, b) => a.name < b.name ? -1 : 1);
            return { data: sorted.slice(offset, offset + Math.min(limit, storageCap)), error: null };
          },
          async remove(paths) {
            removed.push({ bucket, paths: [...paths] });
            return { data: [], error: null };
          }
        };
      }
    }
  };
  vm.runInNewContext(compiled, {
    createClient: () => client,
    Deno: { env: { get: () => 'synthetic-only' }, serve: callback => { handler = callback; } },
    Response, console: { error() {} }
  });
  return { removed, queries, listCalls, async run(options) {
    const response = await handler(new Request('https://synthetic.invalid', {
      method: 'POST', headers: { 'x-cleanup-secret': 'synthetic-only' },
      ...(options === undefined ? {} : { body: JSON.stringify(options) })
    }));
    const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, result };
  } };
}

test('actual cleanup handler preserves referenced raw public paths, canonical URLs and active stories', async () => {
  const paths = {
    avatars: `${user}/avatar_test.webp`, wallpapers: `${user}/wallpaper_test.webp`,
    banners: `${user}/banner_test.webp`, 'group-avatars': `${chat}/avatar_test.webp`,
    stories: `${user}/story_test.webp`, 'public-media': `${user}/legacy_avatar.webp`
  };
  const runtime = fixture({
    tables: {
      profiles: [{ id: user, avatar_path: paths.avatars, wallpaper_path: paths.wallpapers, banner_path: paths.banners,
        avatar: `https://project.supabase.co/storage/v1/object/authenticated/public-media/${paths['public-media']}` }],
      chats: [{ id: chat, avatar_path: paths['group-avatars'] }],
      stories: [{ id: uuid(3), media_path: paths.stories, expires_at: new Date(Date.now() + 86400_000).toISOString() }]
    }, files: Object.entries(paths).map(([bucket, path]) => object(bucket, path))
  });
  const { status, result } = await runtime.run();
  assert.equal(status, 200);
  assert.equal(result.completeScan, true);
  assert.equal(Object.values(result.candidates).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(runtime.removed, []);
});

test('handler preserves E2EE files, message-id bindings, raw media paths, forwards and unknown recordings', async () => {
  const encryptedChat = uuid(10);
  const raw = messagePath(uuid(11));
  const opaque = `${encryptedChat}/${user}/msg_${uuid(12)}.jpg`;
  const idBound = messagePath(uuid(13));
  const forward = `${chat}/${user}/forward_${uuid(14)}.jpg`;
  const record = `${chat}/${user}/record_${uuid(15)}.webm`;
  const runtime = fixture({
    tables: { messages: [
      { id: uuid(13), chat_id: chat, media: null },
      { id: uuid(14), chat_id: chat, media: null },
      { id: uuid(16), chat_id: chat, media_path: raw },
      { id: uuid(17), chat_id: encryptedChat, media: 'e2ee:aes-gcm:synthetic:iv' }
    ] }, files: [raw, opaque, idBound, forward, record].map(path => object('chat-attachments', path))
  });
  const { status, result } = await runtime.run();
  assert.equal(status, 200);
  assert.equal(result.candidates.chatAttachments, 0);
  assert.equal(result.skippedUnverifiableChatAttachments, 2);
  assert.deepEqual(runtime.removed, []);
});

test('scans beyond 1000 references with short API pages and short storage pages without dropping live objects', async () => {
  const profiles = Array.from({ length: 1105 }, (_, index) => ({
    id: uuid(1000 + index), avatar_path: `${user}/avatar_${index.toString().padStart(4, '0')}.webp`
  }));
  const messages = Array.from({ length: 1105 }, (_, index) => ({ id: uuid(5000 + index), chat_id: chat, media: null }));
  const files = profiles.map(row => object('avatars', row.avatar_path));
  files.push(object('chat-attachments', messagePath(messages.at(-1).id)));
  const runtime = fixture({ tables: { profiles, messages }, files, rowCap: 73, storageCap: 41 });
  const { status, result } = await runtime.run();
  assert.equal(status, 200);
  assert.equal(result.candidates.avatars, 0);
  assert.equal(result.candidates.chatAttachments, 0);
  assert.ok(runtime.queries.filter(query => query.table === 'profiles').length > 15);
  assert.ok(runtime.listCalls.some(call => call.bucket === 'avatars' && call.offset > 1000));
  assert.deepEqual(runtime.removed, []);
});

test('dryRun reports genuine candidates without deleting; default cron invocation removes only proven old orphans', async () => {
  const files = [object('avatars', `${user}/unused.webp`), object('avatars', `${user}/new.webp`, recent),
    object('chat-attachments', messagePath(uuid(40))), object('chat-attachments', messagePath(uuid(41)), recent)];
  const runtime = fixture({ files });
  const dry = await runtime.run({ dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.result.dryRun, true);
  assert.equal(dry.result.candidates.chatAttachments, 1);
  assert.equal(dry.result.candidates.avatars, 1);
  assert.ok(Object.values(dry.result.deleted).every(value => value === 0));
  assert.deepEqual(runtime.removed, []);
  const live = await runtime.run();
  assert.equal(live.status, 200);
  assert.equal(live.result.dryRun, false);
  assert.deepEqual(runtime.removed, [
    { bucket: 'chat-attachments', paths: [messagePath(uuid(40))] },
    { bucket: 'avatars', paths: [`${user}/unused.webp`] }
  ]);
});

test('all reference/storage scans finish before deletion; incomplete, failed or repeated pages fail closed', async () => {
  const profiles = [{ id: uuid(50), avatar_path: `${user}/live.webp` }, { id: uuid(51), avatar_path: `${user}/live2.webp` }];
  for (const failure of [{ failTable: 'profiles' }, { repeatTable: 'profiles' }, { nullTable: 'profiles' }, { failBucket: 'banners' }]) {
    const runtime = fixture({ tables: { profiles }, rowCap: 1,
      files: [object('chat-attachments', messagePath(uuid(52))), object('avatars', `${user}/unused.webp`)], ...failure });
    const { status } = await runtime.run();
    assert.equal(status, 500, JSON.stringify(failure));
    assert.deepEqual(runtime.removed, [], JSON.stringify(failure));
  }
});

test('cleanup validates dry-run input and requires the existing secret verifier', async () => {
  const unauthorized = fixture({ authorized: false });
  assert.equal((await unauthorized.run({ dryRun: true })).status, 403);
  assert.deepEqual(unauthorized.queries, []);
  const invalid = fixture();
  assert.equal((await invalid.run({ dryRun: 'true' })).status, 400);
  assert.deepEqual(invalid.queries, []);
  assert.deepEqual(invalid.removed, []);
});

test('owner-published avatars in chat attachments and canonical dedicated media survive deletion of their message', async () => {
  const path = messagePath(uuid(60));
  const canonical = `${user}/canonical.webp`;
  const runtime = fixture({ tables: { profiles: [{ id: user,
    avatar: `storage://chat-attachments/${path}`, banner: `storage://banners/${canonical}` }] },
    files: [object('chat-attachments', path), object('banners', canonical)] });
  const { status, result } = await runtime.run();
  assert.equal(status, 200);
  assert.equal(result.candidates.chatAttachments, 0);
  assert.equal(result.candidates.banners, 0);
  assert.deepEqual(runtime.removed, []);
});
