import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authScreen = await readFile(new URL('../src/components/AuthScreen.jsx', import.meta.url), 'utf8');
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

test('Variant A: Segmented switch with sliding pill indicator', () => {
  // Verifies sliding pill indicator element
  assert.match(authScreen, /auth-tabs-slider/);
  assert.match(authScreen, /is-login/);
  assert.match(authScreen, /is-register/);
  assert.match(authScreen, /className="auth-tabs"/);
  assert.match(authScreen, /className=\{`auth-tab \$\{isLogin \? 'active' : ''\}`\}/);

  // Verifies CSS transitions and sliding pill mechanics
  assert.match(indexCss, /\.auth-tabs-slider\s*\{/);
  assert.match(indexCss, /\.auth-tabs-slider\.is-register\s*\{[^}]*transform:\s*translateX\(100%\)/);
  assert.match(indexCss, /html\.theme-light\s+\.auth-tabs-slider/);
});

test('Variant A: Password input with Caps Lock detector and focus retention', () => {
  // Caps Lock detection on keys and mouse click
  assert.match(authScreen, /getModifierState\('CapsLock'\)/);
  assert.match(authScreen, /auth-capslock-indicator/);
  assert.match(authScreen, /Caps Lock/);
  assert.match(authScreen, /onClick=\{handlePasswordKey\}/);

  // Focus retention and dual mouse/keyboard/touch activation on show/hide toggle
  assert.match(authScreen, /onMouseDown=\{handleTogglePassword\}/);
  assert.match(authScreen, /onClick=\{handleTogglePassword\}/);
  assert.match(authScreen, /passwordInputRef\.current\.focus\(\)/);
  assert.match(authScreen, /e\.preventDefault\(\)/);

  // Submission on Enter via form and duplicate submission guard
  assert.match(authScreen, /<form[^>]*onSubmit=\{handleSubmit\}/);
  assert.match(authScreen, /type="submit"/);
  assert.match(authScreen, /if \(loading\) return;/);
});

test('Variant A: 4-segment password strength progress bar with concise hints', () => {
  // 4-segment horizontal progress bar
  assert.match(authScreen, /auth-strength-segments/);
  assert.match(authScreen, /auth-strength-segment/);
  assert.match(authScreen, /\[1,\s*2,\s*3,\s*4\]\.map/);

  // Concise hints instead of bulky checklist
  assert.match(authScreen, /auth-requirements-compact/);
  assert.match(authScreen, /unmetHints/);
  assert.doesNotMatch(authScreen, /auth-requirements-list/);

  // CSS for 4-segment grid and compact chips
  assert.match(indexCss, /\.auth-strength-segments\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  assert.match(indexCss, /\.auth-req-tag/);
});

test('Variant A: Compact demo quick-login button under submit button', () => {
  assert.match(authScreen, /auth-demo-compact-section/);
  assert.match(authScreen, /auth-demo-quick-btn/);
  assert.match(authScreen, /handleDemoLogin/);
  assert.match(authScreen, /alex_dev/);

  // Verifies the demo button appears AFTER the submit button in the JSX structure
  const submitIndex = authScreen.indexOf('auth-submit-btn');
  const demoIndex = authScreen.indexOf('auth-demo-compact-section');
  assert.ok(submitIndex > 0 && demoIndex > submitIndex, 'Demo button must be located below main submit button');

  // Bulky warning banner removed from top
  assert.doesNotMatch(authScreen, /auth-warning-alert/);
});

test('Variant A: Mini-chat dialog simulator with 4 technical scenarios', () => {
  // Scenario 0: MLS / E2EE
  assert.match(authScreen, /MLS v1\.0/);
  assert.match(authScreen, /AES-256 GCM/);
  assert.match(authScreen, /KeyPackage/);
  assert.match(authScreen, /Safety/);

  // Scenario 1: Offline Cache & Instant Send
  assert.match(authScreen, /IndexedDB/);
  assert.match(authScreen, /PendingClock/);
  assert.match(authScreen, /DoubleCheck/);
  assert.match(authScreen, /offlineState/);

  // Scenario 2: Media Messages
  assert.match(authScreen, /mini-video-circle/);
  assert.match(authScreen, /mini-voice-waveform/);
  assert.match(authScreen, /Opus HD/);
  assert.match(authScreen, /h\.264/);

  // Scenario 3: Reactions (SVG only)
  assert.match(authScreen, /mini-reactions-row/);
  assert.match(authScreen, /mini-react-tag/);
  assert.match(authScreen, /ThumbsUp/);

  // Top scenario switcher tabs
  assert.match(authScreen, /mini-chat-scenario-chips/);
  assert.match(authScreen, /scenario-chip/);

  // Mini-chat UI window
  assert.match(authScreen, /mini-chat-container/);
  assert.match(authScreen, /mini-chat-topbar/);
  assert.match(authScreen, /Alex Developer/);

  // Keyframe animations defined in index.css
  assert.match(indexCss, /@keyframes\s+pulseDot/);
  assert.match(indexCss, /@keyframes\s+rotateCircleOffset/);
  assert.match(indexCss, /@keyframes\s+waveBarAnim/);

  // Light theme contrast definitions
  assert.match(indexCss, /html\.theme-light\s+\.mini-chat-system-badge/);
  assert.match(indexCss, /html\.theme-light\s+\.crypto-val\.mono/);
  assert.match(indexCss, /html\.theme-light\s+\.mini-net-indicator\.online/);
});

test('Variant A: Strictly zero emojis in AuthScreen component', () => {
  // Regex to detect emoji characters (Unicode pictorials)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
  assert.doesNotMatch(authScreen, emojiRegex, 'AuthScreen must contain strictly zero emojis');
});

test('Variant A: Mobile & low-height screen responsiveness in index.css', () => {
  // Mobile responsive layout
  assert.match(indexCss, /@media\s*\(max-width:\s*768px\)/);
  assert.match(indexCss, /@media\s*\(max-width:\s*860px\)/);

  // Small viewport height (down to 600px)
  assert.match(indexCss, /@media\s*\(max-height:\s*640px\)/);
  assert.match(indexCss, /\.auth-screen-container\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(indexCss, /\.auth-screen-container\s*\{[^}]*align-items:\s*safe center/);
});

test('Variant A: Preserves all core auth logic and contracts', () => {
  assert.match(authScreen, /signInWithIdentifier/);
  assert.match(authScreen, /signUpWithUsername/);
  assert.match(authScreen, /id=\{isLogin \? 'loginIdentifier' : 'username'\}/);
  assert.match(authScreen, /id="password"/);
  assert.match(authScreen, /className="auth-logo-img"/);
  assert.match(authScreen, /auth-footer-security/);
  assert.match(authScreen, /rememberMe/);
  assert.match(authScreen, /displayName/);
});
