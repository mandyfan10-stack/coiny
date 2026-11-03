import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Brand logo assets exist across web, android, and desktop', () => {
  const publicLogo = path.join(rootDir, 'public', 'logo.png');
  const publicLogo192 = path.join(rootDir, 'public', 'logo192.png');
  const publicLogo512 = path.join(rootDir, 'public', 'logo512.png');
  const assetsLogo = path.join(rootDir, 'src', 'assets', 'logo.png');
  const faviconSvg = path.join(rootDir, 'public', 'favicon.svg');
  const faviconIco = path.join(rootDir, 'public', 'favicon.ico');
  const manifestJson = path.join(rootDir, 'public', 'manifest.json');

  assert.ok(fs.existsSync(publicLogo) && fs.statSync(publicLogo).size > 1000, 'public/logo.png must exist and be valid');
  assert.ok(fs.existsSync(publicLogo192) && fs.statSync(publicLogo192).size > 1000, 'public/logo192.png must exist');
  assert.ok(fs.existsSync(publicLogo512) && fs.statSync(publicLogo512).size > 1000, 'public/logo512.png must exist');
  assert.ok(fs.existsSync(assetsLogo) && fs.statSync(assetsLogo).size > 1000, 'src/assets/logo.png must exist');
  assert.ok(fs.existsSync(faviconSvg) && fs.statSync(faviconSvg).size > 100, 'public/favicon.svg must exist');
  assert.ok(fs.existsSync(faviconIco) && fs.statSync(faviconIco).size > 500, 'public/favicon.ico must exist');
  assert.ok(fs.existsSync(manifestJson), 'public/manifest.json must exist');
});

test('public/favicon.svg and manifest.json contain proper logo references', () => {
  const faviconSvg = fs.readFileSync(path.join(rootDir, 'public', 'favicon.svg'), 'utf8');
  assert.ok(faviconSvg.includes('<svg') && faviconSvg.includes('data:image/png;base64,'), 'favicon.svg must embed image data');

  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'manifest.json'), 'utf8'));
  assert.equal(manifest.short_name, 'Coiny');
  assert.ok(manifest.icons.some((icon) => icon.src.includes('logo192.png')));
  assert.ok(manifest.icons.some((icon) => icon.src.includes('logo512.png')));
});

test('index.html links to new favicon, logo, and manifest', () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('favicon.svg'), 'Must link favicon.svg');
  assert.ok(indexHtml.includes('logo192.png'), 'Must link logo192.png');
  assert.ok(indexHtml.includes('manifest.json'), 'Must link manifest.json');
});

test('AuthScreen and ChatArea use the brand logo', () => {
  const authScreen = fs.readFileSync(path.join(rootDir, 'src', 'components', 'AuthScreen.jsx'), 'utf8');
  assert.ok(authScreen.includes('className="auth-logo-img"'), 'AuthScreen must render auth-logo-img');
  assert.ok(authScreen.includes('src={coinyLogo}'), 'AuthScreen must use bundled coinyLogo');

  const emptyState = fs.readFileSync(path.join(rootDir, 'src', 'components', 'chat', 'ChatEmptyState.jsx'), 'utf8');
  assert.ok(emptyState.includes('className="empty-state-logo-img"'), 'Chat empty state must render empty-state-logo-img');
  assert.ok(emptyState.includes('src={coinyLogo}'), 'Chat empty state must use bundled coinyLogo');
});

test('Android mipmap launcher icons and splash screens exist across densities', () => {
  const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const resDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res');

  for (const density of densities) {
    const fg = path.join(resDir, `mipmap-${density}`, 'ic_launcher_foreground.png');
    const launcher = path.join(resDir, `mipmap-${density}`, 'ic_launcher.png');
    const round = path.join(resDir, `mipmap-${density}`, 'ic_launcher_round.png');
    assert.ok(fs.existsSync(fg), `ic_launcher_foreground.png must exist for ${density}`);
    assert.ok(fs.existsSync(launcher), `ic_launcher.png must exist for ${density}`);
    assert.ok(fs.existsSync(round), `ic_launcher_round.png must exist for ${density}`);
  }

  const splash = path.join(resDir, 'drawable', 'splash.png');
  assert.ok(fs.existsSync(splash) && fs.statSync(splash).size > 1000, 'Android splash.png must exist');
});

test('Electron window is configured with app icon', () => {
  const electronMain = fs.readFileSync(path.join(rootDir, 'electron-main.cjs'), 'utf8');
  assert.ok(electronMain.includes('logo.png'), 'electron-main.cjs must configure icon with logo.png');
});
