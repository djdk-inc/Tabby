# Observed behavior of the source extensions

Observed on 2026-10-28 in isolated, headed Playwright Chromium profiles. Current CRX3 packages were retrieved from Google's extension update service and unpacked only for behavioral inspection. They are not redistributed with Tabby.

## Tab Organizer: Productivity Tool

- Requested/store ID: `hjdhimdmbhgadalmpkkfnpjeppnkfabd`
- Retrieved package: MV3, version 0.0.51
- Package permissions include `tabs`, `tabGroups`, `storage`, `alarms`, and `sidePanel`.
- Live tabs on `example.com` were grouped into a native group titled **Example** in the isolated browser.
- The package advertises commands for grouping, saving for later, closing duplicates, sorting tabs by domain/title, expanding/collapsing/ungrouping groups, and sorting group titles.
- Its current public site describes automatic domain/page-title grouping, search, window views, merging, and a duplicate-review flow.

## Session Buddy

- ID: `edacconmaakjimmfgnblocblbcdcpbko`
- Retrieved package: MV3, version 4.1.2
- The real extension page displayed the three live tabs in the isolated profile.
- Clicking its visible **Save** control produced a timestamped collection containing three links and showed **Tabs saved**.
- The UI also exposed Collections, History, and Open from text. The current store listing describes session recovery, collections, search, import/export, and local-by-default storage.

## Window Merger

- ID supplied in the request: `fijodggmkbkjcmlpkpahjpepngpddppb` (not found)
- Live package ID: `fijodggmkbkjcmlpkpahjpepngppdppb`
- Retrieved package: MV3, version 1.5.0
- Package code and listing define an action/`Alt+Shift+M` workflow that merges normal windows separately from incognito windows while preserving pinned tabs, groups, collapse state, and mute state.
- The package loaded in isolated Chromium and two test windows were created. The browser-level shortcut did not dispatch under Playwright, so original-extension merge execution is marked blocked rather than verified.
- Tabby's own merge path was separately exercised in the real browser and passed.

## Consolidation decisions

Tabby keeps the core local workflows in one small UI: domain/subdomain groups, alphabetical group ordering, inactive collapse, deduplication, a saved-tab library, session save/restore, and window consolidation. It does not copy source code or proprietary UI from the inspected extensions.
