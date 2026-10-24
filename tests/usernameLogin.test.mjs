import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as authEmail from '../src/services/authEmail.ts';

const edgeSource = await readFile(new URL('../supabase/functions/username-login/index.ts', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../src/services/authService.js', import.meta.url), 'utf8');
const edgeScript = ts.transpileModule(edgeSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/^import .*;$/gm, '').replace(/^export\s*\{\s*\};?$/gm, '');
const serviceScript = serviceSource.replace(/^import[\s\S]*?;\s*/gm, '')
  .replace('export const authService', 'const authService');

function edge({ missing = false, denied = false, grantError = null, quotaError = null, resolutionError = null, throwLookup = false } = {}) {
  const seen = { grants: [], buckets: [], ids: [], logs: [] };
  let handler;
  const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key', SUPABASE_ANON_KEY: 'public-test-key' };
  const client = {
    rpc: async (name, args) => {
      if (name === 'consume_username_login_quota') {
        seen.buckets.push(args.p_bucket_keys);
        return { data: !denied, error: quotaError };
      }
      assert.equal(name, 'resolve_username_login_profile_id');
      assert.equal(args.p_username, 'alice');
      return { data: missing ? null : '11111111-1111-4111-8111-111111111111', error: resolutionError };
    },
    auth: {
      admin: { getUserById: async id => {
        seen.ids.push(id);
        if (throwLookup) throw new Error('private-email@example.test sensitive detail');
        return { data: { user: missing ? null : { id, email: 'private-email@example.test' } } };
      } },
      signInWithPassword: async input => {
        seen.grants.push(input);
        return { data: { session: grantError || missing ? null : { access_token: 'authenticated-access', refresh_token: 'authenticated-refresh' } }, error: grantError || (missing ? { status: 400 } : null) };
      }
    }
  };
  new Function('createClient', 'Deno', 'console', edgeScript)(() => client, {
    env: { get: key => env[key] }, serve: value => { handler = value; }
  }, { error: (...args) => seen.logs.push(args) });
  const request = (body = { username: ' ALICE ', password: 'Correct#12345' }, headers = {}, method = 'POST') => handler(new Request('https://synthetic.supabase.co/functions/v1/username-login', {
    method, headers: { origin: 'https://mandyfan10-stack.github.io', apikey: 'public-test-key', 'Content-Type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  }));
  return { request, seen };
}

test('existing Edge handler verifies the linked email password and only returns session credentials', async () => {
  const { request, seen } = edge();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { session: { access_token: 'authenticated-access', refresh_token: 'authenticated-refresh' } });
  assert.equal(seen.grants[0].email, 'private-email@example.test');
  assert.equal(seen.grants[0].password, 'Correct#12345');
  assert.equal(seen.buckets[0].length, 2);
  assert.ok(seen.buckets[0].every(value => /^[a-f0-9]{64}$/.test(value)));
  assert.deepEqual(seen.logs, []);
});

test('unknown username and wrong password have identical response without email or tokens', async () => {
  const missing = edge({ missing: true });
  const wrong = edge({ grantError: { status: 400, message: 'private-email@example.test rejected' } });
  const missingResponse = await missing.request();
  const wrongResponse = await wrong.request();
  assert.equal(missingResponse.status, 401);
  assert.equal(wrongResponse.status, 401);
  assert.deepEqual(await missingResponse.json(), await wrongResponse.json());
  assert.match(missing.seen.grants[0].email, /^missing-[a-f0-9]{32}@coiny\.invalid$/);
});

test('Edge quota denial and Auth 429 remain rate limits', async () => {
  const quota = edge({ denied: true });
  assert.equal((await quota.request()).status, 429);
  assert.equal(quota.seen.grants.length, 0);
  const auth = edge({ grantError: { status: 429 } });
  assert.equal((await auth.request()).status, 429);
});

test('Edge failure responses and logs do not disclose email, password or session', async () => {
  for (const options of [{ quotaError: { code: 'XX000', message: 'sensitive' } }, { resolutionError: { code: 'XX000', message: 'sensitive' } }, { throwLookup: true }]) {
    const { request, seen } = edge(options);
    const response = await request();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text() + JSON.stringify(seen.logs), /private-email|Correct#|authenticated-access|sensitive/);
    assert.equal(seen.grants.length, 0);
  }
});

test('Edge rejects invalid origins, keys, methods and invalid/oversize input before credential lookup', async () => {
  const { request, seen } = edge();
  assert.equal((await request(undefined, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await request(undefined, { apikey: 'wrong' })).status, 401);
  assert.equal((await request(undefined, {}, 'GET')).status, 405);
  assert.equal((await request({ username: 'alice', password: 'a'.repeat(1025) })).status, 401);
  assert.equal((await request({ username: 'bad-name', password: 'Valid#12345' })).status, 401);
  assert.equal((await request(undefined, { 'content-length': '8193' })).status, 400);
  assert.deepEqual(seen.buckets, []);
});

test('native origins support preflight and keep the same password verification', async () => {
  for (const origin of ['app://coiny', 'https://localhost']) {
    const accepted = edge();
    const preflight = await accepted.request(undefined, { origin }, 'OPTIONS');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(accepted.seen.grants.length, 0);
    const valid = await accepted.request(undefined, { origin });
    assert.equal(valid.status, 200);
    assert.equal(accepted.seen.grants[0].email, 'private-email@example.test');
    assert.equal(accepted.seen.grants[0].password, 'Correct#12345');
    const rejected = edge({ grantError: { status: 400 } });
    const invalid = await rejected.request({ username: 'alice', password: 'Wrong#12345' }, { origin });
    assert.equal(invalid.status, 401);
    assert.equal(rejected.seen.grants[0].password, 'Wrong#12345');
    assert.deepEqual(await invalid.json(), { error: 'Invalid username, email, or password.' });
  }
});

test('foreign and unapproved native origins remain forbidden', async () => {
  for (const origin of ['https://attacker.invalid', 'app://attacker', 'http://localhost', 'capacitor://localhost']) {
    const { request, seen } = edge();
    assert.equal((await request(undefined, { origin }, 'OPTIONS')).status, 403);
    assert.equal((await request(undefined, { origin })).status, 403);
    assert.deepEqual(seen.buckets, []);
    assert.deepEqual(seen.grants, []);
  }
});

function service({ direct = null, functionStatus = null, functionError = null, persistError = null } = {}) {
  const calls = [];
  const supabase = {
    auth: {
      signInWithPassword: async credentials => {
        calls.push(['password', credentials.email]);
        return direct ? direct(credentials) : { error: { code: 'invalid_credentials' } };
      },
      setSession: async session => {
        calls.push(['persist', session]);
        return persistError ? { error: persistError } : { data: { user: { id: 'alice-id' } } };
      }
    },
    functions: { invoke: async (name, options) => {
      calls.push(['function', name, options]);
      return functionStatus ? { error: { context: new Response(JSON.stringify({ error: 'opaque server failure' }), { status: functionStatus }) } } :
        functionError ? { error: functionError } : { data: { session: { access_token: 'access', refresh_token: 'refresh' } } };
    } }
  };
  const auth = new Function('supabase', 'isSupabaseConfigured', 'isMockMode', ...Object.keys(authEmail), `${serviceScript}\nreturn authService;`)(supabase, true, false, ...Object.values(authEmail));
  return { auth, calls };
}

test('nickname with linked real email falls back to existing Edge and persists the verified session', async () => {
  const { auth, calls } = service();
  assert.deepEqual(await auth.signIn(' ALICE ', 'Correct#12345'), { data: { id: 'alice-id' } });
  assert.deepEqual(calls.slice(0, 2), [['password', 'alice@coiny.users.local'], ['password', 'alice@tg-clone.com']]);
  assert.deepEqual(calls[2], ['function', 'username-login', { body: { username: 'alice', password: 'Correct#12345' }, timeout: 12_000 }]);
  assert.equal(calls[3][0], 'persist');
});

test('modern, legacy and direct email successful login retain the existing direct path', async () => {
  for (const target of ['alice@coiny.users.local', 'alice@tg-clone.com', 'real@example.test']) {
    const { auth, calls } = service({ direct: ({ email }) => email === target ? { data: { user: { id: 'direct-id' } } } : { error: { code: 'invalid_credentials' } } });
    const result = await auth.signIn(target.includes('example') ? target : 'alice', 'Correct#12345');
    assert.equal(result.data.id, 'direct-id');
    assert.ok(calls.every(call => call[0] === 'password'));
  }
});

test('bans, unconfirmed account and rate limits do not start Edge fallback', async () => {
  for (const code of ['user_banned', 'email_not_confirmed', 'over_request_rate_limit']) {
    const { auth, calls } = service({ direct: () => ({ error: { code } }) });
    assert.ok((await auth.signIn('alice', 'Correct#12345')).error);
    assert.equal(calls.length, 1);
  }
});

test('fallback failure has actionable copy and never persists an unverified session', async () => {
  for (const [status, copy] of [[401, /Неверный логин или пароль/], [429, /Слишком много/], [503, /временно недоступен/]]) {
    const { auth, calls } = service({ functionStatus: status });
    assert.match((await auth.signIn('alice', 'Correct#12345')).error.message, copy);
    assert.ok(!calls.some(call => call[0] === 'persist'));
  }
  const offline = service({ functionError: new TypeError('Network error') });
  assert.match((await offline.auth.signIn('alice', 'Correct#12345')).error.message, /временно недоступен/);
  const broken = service({ persistError: { code: 'invalid_credentials' } });
  assert.ok((await broken.auth.signIn('alice', 'Correct#12345')).error);
});
