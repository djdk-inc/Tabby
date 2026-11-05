# Tabby

Tabby is a local-first Manifest V3 Chrome extension that consolidates the requested tab-organizing, window-merging, and session-saving workflows.

## Features

- Organizes existing and newly navigated web tabs into native Chrome groups by domain or full subdomain.
- Orders native groups alphabetically and gives them stable Chrome colors.
- Uses compact symbols for recognized sites (for example `𝕏` instead of `x.com`) and falls back to the domain name.
- Runs merge windows, URL deduplication, grouping/sorting, and inactive-group collapse together through **Organize now**.
- Collapses groups after a configurable inactive period and reopens the active group.
- Collapses the group you leave immediately and expands the group you enter (default on).
- Removes duplicate URLs, optionally ignoring fragments and common tracking parameters.
- Never automatically closes or regroups a pinned or currently audible tab when protection is enabled.
- Saves a canonical-URL-deduplicated local library and shows it as one simple alphabetical list.
- Saves and restores multi-window sessions, including pinned and muted state.
- Exports all saved sessions as JSON or flat CSV from the Sessions screen.
- Consolidates normal windows into the current window and preserves pinned tabs.
- Coalesces same-domain groups from merged windows into one native group.
- Limits configured domains to 3 regular tabs across all normal Chrome windows during configurable local-time focus hours and weekdays.
- Replaces a fourth limited tab with a decision page that preserves the requested URL and offers existing-tab focus, save-for-later, explicit bypass, or close actions.
- Treats protected pinned and audible tabs as focus-limit exceptions.
- Stores all settings, saved tabs, and sessions locally in `chrome.storage.local`.

## Install in Chrome

1. Unzip `tabby-1.1.1.zip`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped `tabby-1.1.1` folder—the folder containing `manifest.json`.
6. Pin **Tabby** from Chrome's Extensions menu if you want one-click access.

Chrome may show a warning for developer-mode extensions after a restart. This build is intentionally unpacked and has not been submitted to the Chrome Web Store.

Keyboard shortcuts on macOS:

- `Command+Shift+X`: run the complete **Organize now** workflow

Keyboard shortcuts on Windows/Linux:

- `Ctrl+Shift+X`: run the complete **Organize now** workflow

Chrome can leave a suggested shortcut unassigned when it conflicts with the browser or another extension. Verify or change the active binding at `chrome://extensions/shortcuts`.

## Use

The toolbar popup exposes the common actions. Open **Library, sessions & settings** for saved tabs, session restore, and configuration.

Focus tab limits are off until enabled. In Settings, choose local start and end times, active weekdays, and one limited domain per line. Equal start and end times mean all day on the selected days; overnight ranges continue into the next morning. Subdomains count under the configured parent domain. Limits apply only to new navigations while the schedule is active, so enabling a schedule never retroactively closes existing tabs.

Automatic grouping only handles `http://` and `https://` tabs. Chrome internal pages, extension pages, and protected pinned/audible tabs are deliberately left alone. Domain mode uses a compact built-in public-suffix heuristic; choose **Subdomain** when exact host boundaries matter.

## Test

Requirements: Node.js 20+ and Playwright Chromium.

```sh
npm install
npx playwright install chromium
npm run test:unit
npm run test:e2e
```

The E2E suite launches an isolated, headed Chromium profile with the real unpacked extension. It does not mock `chrome.tabs`, `chrome.tabGroups`, `chrome.windows`, or `chrome.storage`. Current Chromium headless mode does not reliably initialize unpacked MV3 service workers, so the suite intentionally uses a real browser window.

See `TEST_REPORT.md` for the observed results and limitations.
