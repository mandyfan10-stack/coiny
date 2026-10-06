# UI regressions covered by v1.20.70

- Creation dialogs reserve a 38 px gutter for the search icon, including compact landscape inputs.
- The media picker becomes a bottom sheet at widths up to 768 px. Its height and keyboard offset follow `visualViewport`; desktop popovers fit above their trigger. Headers remain fixed while content scrolls.
- Story creation keeps its gallery fallback when the camera API is absent or permission is denied. Capture/flip controls appear only with an active camera.
- `useChatLoader.historyLoadStatus` distinguishes loading, successful history and a failed request. Empty cache reads cannot restart loading. Request identity and account identity prevent stale responses from replacing current state; late cache hydration preserves fresh message fields and older history.
- Empty successful histories show a message. Failures expose a retry through the existing `loadActiveChatMessages`; cached messages remain available during refresh.
- React receives `WebkitClipPath` in both path and SVG geometry strategies.

`npm run test:ui` exercises the real components and loader with controlled cache/network responses. Its WebKit project verifies both bubble geometry strategies. Install browsers with `npx playwright install --with-deps chromium webkit`. `npm run test:scroll` covers history restoration and pagination; `npm run test:e2e` checks the built mock application and runs live checks when QA credentials are provided.

Server APIs, database schema and encryption operations are unchanged.
