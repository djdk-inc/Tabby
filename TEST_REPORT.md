# Tabby verification report

Date: 2026-11-04
Host: macOS (Apple Silicon)
Browser: Playwright Chromium 156.0.8078.80, isolated persistent contexts
Extension: Tabby 1.1.1, Manifest V3

## Acceptance method

The automated acceptance suite loaded the actual unpacked extension with `--load-extension` in a new persistent browser profile. The final 15-test run used the folder extracted from the exact distributed ZIP. Assertions queried the real `chrome.tabs`, `chrome.tabGroups`, `chrome.windows`, and `chrome.storage.local` APIs from extension pages. Test pages were opened and manipulated as real tabs. No browser APIs were mocked.

## Results

| Outcome | Status | Browser evidence |
|---|---:|---|
| Popup and dashboard render | Verified | Real `chrome-extension://` pages rendered and dashboard screenshot captured. |
| Install-ready ZIP layout | Verified | The distributed ZIP was extracted and its root folder loaded directly into contained Chromium; all 15 real-browser E2E checks passed against it. |
| Organize existing tabs by domain | Verified | Live localhost, `example.com`, and `iana.org` tabs received native groups. |
| Alphabetical native group order | Verified | Tab-strip group order matched locale-sorted group titles. |
| Compact recognized-site labels | Verified | A real `x.com` tab formed a native group titled `𝕏`; unknown sites retained their domain labels. |
| Organize a newly opened tab | Verified | A newly navigated tab acquired a native group after the event handler ran. |
| Domain/subdomain setting | Verified | Domain logic has unit coverage; subdomain selection persisted through the real Settings UI. |
| URL deduplication | Verified | Canonically equivalent URLs were reduced to one tab. |
| Pinned-tab protection | Verified | The pinned copy survived and remained pinned while the unprotected duplicate closed. |
| Audible-tab protection | Verified | A real Web Audio oscillator made a tab report `audible: true`; it survived while the silent duplicate closed. |
| Saved-tab library | Verified | Live web tabs were saved to local extension storage and rendered by the dashboard. |
| Saved-tab deduplication and flat list | Verified | Repeated canonical URLs produced one saved item; the dashboard rendered one ungrouped alphabetical list. |
| Save and restore sessions | Verified | A named multi-window snapshot was saved, then restored into new browser windows. |
| Session JSON and CSV export | Verified | Dashboard buttons produced real browser downloads; parsed JSON and escaped CSV contained the saved session and its tabs. |
| Composite Organize Now workflow | Verified | One real-browser action merged windows, removed a canonical duplicate, grouped the surviving tabs, and evaluated inactive-group collapse. |
| Keyboard command configuration | Verified | Feature tests validated `Command+Shift+X` on macOS and `Ctrl+Shift+X` elsewhere for the composite Organize Now handler. |
| Inactive group collapse | Verified | An inactive native group collapsed through the extension action. |
| Collapse on leave / expand on enter | Verified | Activating a tab in another native group immediately collapsed the prior group and expanded the destination group. |
| Window consolidation | Verified | A second normal window was merged into the target and its pinned tab remained pinned. |
| Cross-window group coalescing | Verified | Same-domain tabs from different windows ended in one native group after consolidation. |
| Settings persistence | Verified | A dashboard UI change persisted through `chrome.storage.local`. |
| Configurable focus hours | Verified | Real Settings controls persisted enablement, local start time, weekdays, and normalized domain entries. |
| Schedule boundaries | Verified | Browser and unit checks confirmed start-inclusive/end-exclusive daytime hours plus overnight continuation into the next morning. |
| Fourth-tab safe gate | Verified | A fourth limited-domain tab remained open as a Tabby decision page with the requested URL preserved and 3 existing-tab choices. |
| Cross-window limit | Verified | The 3 existing tabs were split across two normal windows and still counted toward one domain-wide limit. |
| Explicit bypass and exceptions | Verified | **Open anyway** restored the fourth URL in the same tab; a pinned tab and an inactive schedule bypassed the gate. |
| Non-regression | Verified | Grouping, compact labels, deduplication, pinned/audible protection, sessions, exports, collapse, and window merge tests remained green. |

Final automated result: **9/9 feature/unit tests and 15/15 real-browser E2E tests passed**. A separate headed Playwright exercise also passed the fourth-tab, cross-window, explicit-bypass, pinned-exception, and schedule-boundary scenarios. Current acceptance runs use a unique profile and headed Playwright Chromium.

## Original-extension inspection

| Extension | Status | Observation |
|---|---:|---|
| Tab Organizer 0.0.51 | Partially verified | Loaded from its current CRX3 package; live `example.com` tabs formed a native **Example** group. |
| Session Buddy 4.1.2 | Verified for save flow | Its real dashboard saw 3 live tabs; clicking **Save** created a 3-link collection and displayed **Tabs saved**. |
| Window Merger 1.5.0 | Loaded; action blocked | Package loaded and two windows were created. The browser-reserved shortcut did not dispatch under Playwright, so the source extension's merge action is not claimed as executed. The package code and listing were inspected; Tabby's independent merge behavior passed E2E. |

## Native group favicon limitation

Chrome's native `tabGroups.TabGroup` model exposes `collapsed`, `color`, `id`, `shared`, `title`, and `windowId`. `tabGroups.update()` can change only `collapsed`, `color`, and `title`; there is no group icon or favicon field. Individual `tabs.Tab` objects can expose `favIconUrl`, but Chrome provides no supported API to assign that favicon to the native group chip. Tabby therefore substitutes compact Unicode symbols for recognized sites and keeps domain text as the fallback. These symbols are text—not native favicons—and vary slightly by platform. See the official [Chrome tabGroups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) and [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

## Known boundaries

- Automatic grouping ignores non-web URLs and protected pinned/audible tabs.
- Domain mode contains a small multi-part-suffix heuristic rather than the full public suffix list. Subdomain mode is exact.
- Session restore recreates web tabs, windows, pinned state, and muted state, then applies current organization rules; it does not recreate every browser-internal state.
- Saved data is local to the extension profile and does not sync.
- Chrome shortcut conflicts may require reassignment at `chrome://extensions/shortcuts`.

## Source evidence

- [Chrome tabGroups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Session Buddy Chrome Web Store listing](https://chromewebstore.google.com/detail/session-buddy-tab-bookmar/edacconmaakjimmfgnblocblbcdcpbko)
- [Tab Organizer product documentation](https://www.taborganizer.app/en)
- [Window Merger package listing](https://extpose.com/ext/fijodggmkbkjcmlpkpahjpepngppdppb)
