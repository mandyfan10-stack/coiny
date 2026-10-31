// The optional Squirrel builder still reaches temp -> rimraf 2.6.3. Modern
// glob provides the fixed walker/matcher, but its glob() returns a Promise
// and Windows backslashes require explicit legacy separator semantics.
// Adapt only this known import. Refuse an unknown source instead
// of silently patching a different dependency. Remove when upstream migrates.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

let entry;
try {
  const installer = createRequire(require.resolve('electron-winstaller'));
  const temp = createRequire(installer.resolve('temp'));
  entry = temp.resolve('rimraf');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  // This is an optional platform-specific builder, not a runtime dependency.
  process.exit(0);
}

const version = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8')).version;
if (version !== '2.6.3') throw new Error(`Review the legacy rimraf adapter for version ${version}.`);
const original = 'var glob = require("glob")';
const replacement = `var glob = (function (modern) {
  function optionsForPlatform(options) {
    return Object.assign({}, options, { magicalBraces: true, windowsPathsNoEscape: process.platform === 'win32' })
  }
  function legacy(pattern, options, callback) {
    modern.glob(pattern, optionsForPlatform(options)).then(function (matches) { callback(null, matches) }, callback)
  }
  legacy.hasMagic = function (pattern) { return modern.hasMagic(pattern, optionsForPlatform()) }
  legacy.sync = function (pattern, options) { return modern.globSync(pattern, optionsForPlatform(options)) }
  return legacy
})(require("glob"))`;
const source = fs.readFileSync(entry, 'utf8');
if (!source.includes(replacement)) {
  if (source.split(original).length !== 2) throw new Error('Unexpected legacy rimraf source; refusing to patch.');
  fs.writeFileSync(entry, source.replace(original, replacement));
}
