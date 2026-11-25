# Tabby project instructions

## Development

- `extension/` is the whole product: plain MV3 JavaScript, no build step, loaded unpacked.
- Work is committed and pushed straight to `main`: no feature branches or pull requests. The remote holds only `main`.
- Logic with non-obvious behavior lives as pure functions in `extension/core.js`; the service worker only wires those functions to `chrome.*` APIs.
- Tab-strip code tolerates the strip changing underneath it (tabs closing, groups vanishing, user dragging): a run skips the affected step rather than failing, and background listeners never leave uncaught rejections.

## Known errors

- Tabby records every unexpected failure (service worker, message handlers, background listeners, extension pages) and mirrors the log to `~/Downloads/tabby_errors.json`. Each entry has `message`, `source`, `stack`, `version`, `count`, `firstSeen`, and `lastSeen`; repeats share one entry.
- Expected, explained outcomes (`UserFacingError` in `extension/errors.js`) and tab-strip races that Tabby recovers from are not errors and stay out of the log.
- The log starts empty on each version update, so the file lists only errors seen since the installed release.
- "Fix the known errors" means: every entry in `~/Downloads/tabby_errors.json` has a test that reproduces it and now passes, the fix ships in a new release, and that release is installed into the user's unpacked Tabby folder. An entry that is not a bug becomes a `UserFacingError` or a recovered race instead.

## Testing

- Browser tests never take over the user's screen: Playwright runs Chromium's new headless mode (`channel: "chromium"`). A visible browser runs only when someone asks to watch (`TABBY_HEADED=1`).
- Browser tests load the real unpacked extension and drive real `chrome.*` APIs; nothing is mocked.
- A reported bug gets a test that fails before the fix and passes after it. Races get a randomized test (see the tab-strip layout test).
- Unit tests (`npm run test:unit`) cover only pure logic whose behavior is not obvious from the code. Tests that restate config, constants, or library behavior are not kept.
- Behavior automation cannot reach is named as untested in the PR, with a short manual check. Today that is incognito: automation cannot turn on **Allow in Incognito**.
- Done means `npm run test:unit` and `npm run test:e2e` both pass.

## Releases

- Every distributable build increments the semantic version: patch for fixes, minor for backward-compatible features, major for breaking changes. Docs- or test-only commits do not.
- One version string appears in `extension/manifest.json`, `package.json`, `package-lock.json`, the README install steps, the ZIP filenames, and the `vMAJOR.MINOR.PATCH` tag.
- `README.md` is the only documentation and always describes the current behavior; there are no release-notes or test-report files.
- A release is a GitHub release on the tag with `tabby-X.Y.Z.zip` (root folder `tabby-X.Y.Z/` holding `manifest.json`) and `tabby-source-X.Y.Z.zip` (`git archive` of the tag). Its description is a few lines of what changed.
- The user's Chrome loads Tabby unpacked from `~/Downloads/tabby-1.1.1` (the folder name is historical: renaming it changes the extension ID and drops stored data). Installing a release means replacing that folder's contents with the extracted ZIP. Tabby notices the newer manifest on disk and reloads itself (`extension/self-update.js`: on worker start, every minute, and whenever the popup or dashboard opens). The install is confirmed when `~/Downloads/tabby_errors.json` shows the new `version`.
- The install ZIP is extracted and the browser suite passes against it (`TABBY_EXTENSION_PATH=<extracted folder>`) before it is published. A published ZIP is never replaced.
