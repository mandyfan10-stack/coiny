import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'coiny-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('modern glob cancellation and legacy callback cleanup both retain their contracts', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'one.txt'), 'one');
  await writeFile(path.join(root, 'two.js'), 'two');
  const { glob } = require('glob');
  assert.deepEqual(await glob('*.txt', { cwd: root }), ['one.txt']);
  await assert.rejects(glob('**/*', { cwd: root, signal: AbortSignal.abort() }), { name: 'AbortError' });

  // Exercise the optional Squirrel toolchain's actual callback cleanup path.
  const installer = createRequire(require.resolve('electron-winstaller'));
  const temp = createRequire(installer.resolve('temp'));
  await promisify(temp('rimraf'))(path.join(root, '*.txt'));
  await assert.rejects(readFile(path.join(root, 'one.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, 'two.js'), 'utf8'), 'two');
  for (const name of ['brace-one', 'brace-two']) await writeFile(path.join(root, `${name}.txt`), name);
  await promisify(temp('rimraf'))(path.join(root, '{brace-one,brace-two}.txt'));
  for (const name of ['brace-one', 'brace-two']) {
    await assert.rejects(readFile(path.join(root, `${name}.txt`)), { code: 'ENOENT' });
  }
  temp('rimraf').sync(path.join(root, '*.js'));
  await assert.rejects(readFile(path.join(root, 'two.js')), { code: 'ENOENT' });
});

test('the packager can require modern ASAR and preserve dotfiles, Unicode names and unpacked files', async (t) => {
  const root = await fixture(t);
  const input = path.join(root, 'source');
  await mkdir(input);
  await writeFile(path.join(input, 'index.html'), '<title>Coiny fixture</title>');
  await writeFile(path.join(input, '.hidden'), 'configuration');
  await writeFile(path.join(input, 'привет [1].txt'), 'Unicode content');
  await writeFile(path.join(input, 'addon.node'), 'native fixture');
  const asar = require('@electron/asar');
  const archive = path.join(root, 'app.asar');
  await asar.createPackageWithOptions(input, archive, { unpack: '*.node', dot: true });
  assert.equal(asar.extractFile(archive, 'index.html').toString(), '<title>Coiny fixture</title>');
  assert.equal(asar.extractFile(archive, 'привет [1].txt').toString(), 'Unicode content');
  assert.equal(asar.extractFile(archive, '.hidden').toString(), 'configuration');
  assert.equal(asar.statFile(archive, 'addon.node').unpacked, true);
  assert.equal(await readFile(path.join(root, 'app.asar.unpacked', 'addon.node'), 'utf8'), 'native fixture');
});

test('legacy Windows cleanup detects backslash patterns and normalizes async and sync traversal', async () => {
  const installer = createRequire(require.resolve('electron-winstaller'));
  const temp = createRequire(installer.resolve('temp'));
  const source = await readFile(temp.resolve('rimraf'), 'utf8');
  const pattern = String.raw`C:\temp\*.txt`;
  const match = String.raw`C:\temp\one.txt`;
  const removed = [];
  const traversals = [];
  const missing = () => Object.assign(new Error('Missing literal wildcard'), { code: 'ENOENT' });
  const filesystem = {
    lstat(name, callback) { callback(name === pattern ? missing() : null, { isDirectory: () => false }); },
    lstatSync(name) { if (name === pattern) throw missing(); return { isDirectory: () => false }; },
    unlink(name, callback) { removed.push(name); callback(null); },
    unlinkSync(name) { removed.push(name); }
  };
  const modern = require('glob');
  const glob = {
    hasMagic: modern.hasMagic,
    glob(name, options) { traversals.push({ name, options }); return Promise.resolve([match]); },
    globSync(name, options) { traversals.push({ name, options }); return [match]; }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    require: (name) => name === 'glob' ? glob : name === 'fs' ? filesystem : require(name),
    process: { platform: 'win32' },
    setTimeout
  });
  await promisify(module.exports)(pattern, { glob: { dot: true } });
  module.exports.sync(pattern, { glob: { dot: true } });
  assert.deepEqual(removed, [match, match]);
  assert.equal(traversals.length, 2);
  for (const call of traversals) {
    assert.equal(call.name, pattern);
    assert.equal(call.options.windowsPathsNoEscape, true);
    assert.equal(call.options.dot, true);
  }
});

test('Pages publishing retains dotfiles and nested assets using only a disposable local repository', { timeout: 30_000 }, async (t) => {
  const root = await fixture(t);
  const input = path.join(root, 'site');
  const bare = path.join(root, 'remote.git');
  await mkdir(path.join(input, 'assets'), { recursive: true });
  await writeFile(path.join(input, 'index.html'), 'fixture site');
  await writeFile(path.join(input, '.nojekyll'), '');
  await writeFile(path.join(input, 'assets', 'entry.js'), 'fixture asset');
  execFileSync('git', ['init', '--bare', '--quiet', bare]);
  const { publish } = require('gh-pages');
  await publish(input, {
    repo: pathToFileURL(bare).href,
    branch: 'gh-pages',
    dotfiles: true,
    user: { name: 'Coiny test', email: 'test@example.invalid' },
    message: 'Local publication fixture',
    silent: true
  });
  const show = (name) => execFileSync('git', ['--git-dir', bare, 'show', `gh-pages:${name}`], { encoding: 'utf8' });
  assert.equal(show('index.html'), 'fixture site');
  assert.equal(show('assets/entry.js'), 'fixture asset');
  assert.equal(show('.nojekyll'), '');
});
