import { spawnSync } from 'node:child_process';

const env = { ...process.env };
const hasLiveSupabase = Boolean(env.VITE_SUPABASE_URL && (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY));
if (!hasLiveSupabase) {
  env.VITE_ALLOW_MOCK = 'true';
  env.VITE_SUPABASE_URL = 'your-supabase-project-url';
  env.VITE_SUPABASE_PUBLISHABLE_KEY = 'your-supabase-publishable-key';
  env.VITE_SUPABASE_ANON_KEY = 'your-supabase-anon-key';
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['run', 'build'], ['exec', '--', 'playwright', 'test', ...process.argv.slice(2)]]) {
  const result = spawnSync(npm, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
