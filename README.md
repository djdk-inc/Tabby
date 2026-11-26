# Tabby

Tabby is a local-first Manifest V3 Chrome extension that consolidates the requested tab-organizing, window-merging, and session-saving workflows.

## Features

- Organizes existing and newly navigated web tabs into native Chrome groups by domain or full subdomain.
- Orders native groups alphabetically and gives them stable Chrome colors.
- Uses compact symbols for recognized sites (for example `𝕏` instead of `x.com`) and falls back to the domain name.
- Runs merge windows, URL deduplication, grouping/sorting, and inactive-group collapse together through **Organize**.
- Collapses groups after a configurable inactive period and reopens the active group.
- Collapses the group you leave immediately and expands the group you enter (default on).
- Removes duplicate URLs, optionally ignoring fragments and common tracking parameters.
- Never automatically closes or regroups a pinned or currently audible tab when protection is enabled.
- Saves and restores multi-window sessions, including pinned, muted, and incognito state; each window reopens in the mode it was saved in.
- **Saved** lists every URL from all sessions once (tracking parameters and fragments ignored), alphabetically, filterable by All, Incognito (saved from any incognito window), or Regular (never saved from one).
- Shows sessions as compact rows that expand into windows and their URLs; any single window can be reopened on its own.
- Exports sessions (Sessions tab) and saved URLs (Saved tab, current filter) as CSV.
- Consolidates windows like with like: regular windows merge into the current window and incognito windows merge into one incognito window (Chrome cannot move tabs between the two). Pinned tabs stay pinned.
- Coalesces same-domain groups from merged windows into one native group.
- Limits configured domains to 3 tabs across all normal Chrome windows during configurable local-time focus hours and weekdays: a fourth tab on the domain closes as soon as it opens. Every tab counts, pinned and audible ones included; browsing inside a tab already on the domain is never limited.
- Stores all settings and sessions locally in `chrome.storage.local`.
- Keeps a local log of unexpected errors and saves it to your downloads folder as `tabby_errors.json` (repeats are counted, not duplicated; the log resets on each update). Nothing is sent anywhere; the `downloads` permission exists only for this file.

## Install in Chrome

1. Unzip `tabby-2.5.0.zip`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped `tabby-2.5.0` folder—the folder containing `manifest.json`.
6. Pin **Tabby** from Chrome's Extensions menu if you want one-click access.

Chrome may show a warning for developer-mode extensions after a restart. This build is intentionally unpacked and has not been submitted to the Chrome Web Store.

Keyboard shortcuts on macOS:

- `Command+Shift+X`: run the complete **Organize** workflow
- `Command+Shift+S`: save the current session (the Tabby icon shows a ✓)

Keyboard shortcuts on Windows/Linux:

- `Ctrl+Shift+X`: run the complete **Organize** workflow
- `Ctrl+Shift+S`: save the current session

Chrome can leave a suggested shortcut unassigned when it conflicts with the browser or another extension. Verify or change the active binding at `chrome://extensions/shortcuts`.

## Use

The toolbar popup has three buttons: **Organize** (merge windows, remove duplicates, group and sort, collapse inactive groups), **Sessions** (save, browse, and restore sessions), and **Settings**.

Focus tab limits are on by default, all day, every day, for the domains listed in Settings (YouTube, Reddit, X, Instagram, TikTok). Updating from an earlier version moves a schedule still at the old default (9–5 weekdays) to all day, every day, and turns limits on; a schedule you changed is kept. In Settings, choose local start and end times, active weekdays, and one limited domain per line. Equal start and end times mean all day on the selected days; overnight ranges continue into the next morning. Subdomains count under the configured parent domain. Limits apply only to a tab entering the domain while the schedule is active (a new tab, or an existing tab navigating there from elsewhere), so enabling a schedule never closes tabs already open.

Automatic grouping only handles `http://` and `https://` tabs. Chrome internal pages, extension pages, and protected pinned/audible tabs are deliberately left alone. Domain mode uses a compact built-in public-suffix heuristic; choose **Subdomain** when exact host boundaries matter.

## Test

Requirements: Node.js 20+ and Playwright Chromium.

```sh
npm install
npx playwright install chromium
npm run test:unit
npm run test:e2e
```

The E2E suite launches an isolated Chromium profile with the real unpacked extension. It does not mock `chrome.tabs`, `chrome.tabGroups`, `chrome.windows`, or `chrome.storage`. It runs in Chromium's new headless mode (`channel: "chromium"`), which loads MV3 extensions without opening windows; set `TABBY_HEADED=1` to watch it, which also runs the audible-tab test (headless Chromium has no audio output).

Restoring incognito windows requires **Allow in Incognito** on Tabby's details page at `chrome://extensions`.

Development, testing, and release conventions are in `AGENTS.md`.
