# Implementing Chrome Extensions Reliably

This guide distills the engineering and acceptance practices used to build Tabby, a Manifest V3 extension that organizes tabs, merges windows, removes duplicates, and saves sessions.

## 1. Define outcomes before UI

Write the expected browser-visible outcomes first. Examples:

- Existing and newly opened web tabs are grouped by domain.
- Leaving a group expands the destination before collapsing the previous group.
- Duplicate URLs are removed while pinned or audible copies survive.
- Merging windows preserves pinned state and coalesces matching groups.
- Sessions restore their windows, URLs, pinned state, and muted state.

Every claimed outcome should later have a real-browser test. Unit tests alone are insufficient for APIs such as `chrome.tabs`, `chrome.tabGroups`, and `chrome.windows`.

## 2. Start with a minimal MV3 structure

```text
extension/
  manifest.json
  service-worker.js
  core.js
  popup.html
  popup.js
  dashboard.html
  dashboard.js
  ui.css
  icons/
```

Use `manifest_version: 3` and an event-driven service worker. Request only the permissions the implementation needs. Tabby uses:

```json
"permissions": ["tabs", "tabGroups", "storage", "alarms"]
```

Keep deterministic, browser-independent logic in modules such as `core.js`. URL normalization, domain labels, duplicate selection, and export formatting can then be tested without launching Chrome.

## 3. Treat the service worker as disposable

MV3 workers stop and restart. Never rely on process memory for durable state.

- Store user data and settings in `chrome.storage.local`.
- Use `chrome.storage.session` for browser-session coordination state.
- Rebuild derived state when the worker starts.
- Use alarms instead of long-running timers for periodic work.
- Keep listeners registered at module load time.

In-memory queues and short timers are fine for serialization or UI smoothing, but correctness must not depend on them surviving a worker restart.

## 4. Separate identity from presentation

For native groups, retain a canonical domain identity even when the visible title uses a compact symbol. This prevents presentation changes from breaking grouping, deduplication, or saved data.

Chrome native tab-group chips do not accept image icons or favicons. `tabGroups.update()` supports a title, color, and collapsed state. Use a short Unicode symbol for recognized sites and fall back to readable domain text.

## 5. Make destructive tab actions conservative

For deduplication:

1. Normalize the URL hostname, trailing slash, fragment, query ordering, and optional tracking parameters.
2. Bucket tabs by normalized URL.
3. Choose a keeper deterministically.
4. Prefer protected tabs, then the active tab, then the most recently accessed tab.
5. Remove only unprotected duplicates.

Protection settings should cover pinned and audible tabs. Test `audible` with real audio playback rather than assigning a mocked property.

## 6. Serialize event-driven interactions

Tab activation events can overlap. Queue activation work per window so an older event cannot collapse the newly selected group.

A smooth collapse-on-leave sequence is:

1. Expand the destination group immediately.
2. Record the new active group.
3. Wait briefly before collapsing the previous group.
4. Re-check that the user has not returned to it.
5. Collapse only when none of its tabs is active.

## 7. Design session data for export and migration

Store sessions as plain JSON with stable IDs and timestamps:

```json
{
  "id": "uuid",
  "name": "Work session",
  "createdAt": 0,
  "windows": [{
    "tabs": [{
      "url": "https://example.com",
      "title": "Example",
      "pinned": false,
      "muted": false,
      "group": "example.com"
    }]
  }]
}
```

JSON export should preserve the full model. CSV export should flatten one tab per row and escape commas, quotes, and newlines correctly.

## 8. Define shortcuts for each platform

Declare commands in `manifest.json` and dispatch them from `chrome.commands.onCommand`.

```json
"organize-tabs": {
  "suggested_key": {
    "default": "Ctrl+Shift+X",
    "mac": "Command+Shift+X"
  },
  "description": "Merge, deduplicate, organize, and collapse inactive tabs"
}
```

On macOS, use `Command` explicitly for the Command key. `MacCtrl` means the physical Control key. Chrome may leave conflicting suggested shortcuts unassigned, so always instruct users to verify them at `chrome://extensions/shortcuts`.

For a high-frequency workflow, prefer one composite command over several shortcuts. Keep the underlying actions independently callable for testing and troubleshooting, but make the primary action execute them in an intentional order: merge windows, deduplicate URLs, regroup/sort tabs, then evaluate inactive-group collapse.

## 9. Test at three levels

### Feature/unit tests

Test pure functions for:

- Domain and subdomain calculation.
- Compact site-label mapping and fallback.
- Canonical URL normalization.
- Protected duplicate selection.
- JSON/CSV serialization.
- Manifest command declarations for every platform.

### Real-browser E2E tests

Load the unpacked extension with a persistent Chromium context:

```js
chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});
```

Do not mock Chrome APIs for acceptance. Query the real `chrome.tabs`, `chrome.tabGroups`, `chrome.windows`, and `chrome.storage` APIs from an extension page.

Modern headless Chromium may not initialize an unpacked MV3 service worker consistently. For contained acceptance, run headed Chromium inside a Linux virtual display such as Xvfb. This preserves real extension behavior without opening a native desktop window.

### Manual review sandbox

For interactive review without taking over the user's desktop:

- Run Chromium in a container with an ephemeral profile.
- Mount only the extension directory, read-only.
- Stream the virtual display to a browser viewer bound to `127.0.0.1`.
- Never expose the viewer to the LAN or Internet without authentication and hardening.

## 10. Inspect prior products without copying them

When consolidating existing extensions:

- Use isolated profiles.
- Exercise each relevant behavior in the real browser where feasible.
- Record observed outcomes and blockers.
- Reimplement behavior independently.
- Do not redistribute third-party packages or copy proprietary source/UI.

## 11. Package for Chrome correctly

The install ZIP must contain `manifest.json` at its root:

```text
tabby-1.0.0/
  manifest.json
  service-worker.js
  popup.html
  ...
```

Do not put the installable extension inside an extra `extension/` directory unless the installation instructions explicitly tell the user to select that nested directory.

Release verification should:

1. Test the ZIP's integrity.
2. Confirm exactly one root-level `manifest.json`.
3. Extract the distributed ZIP.
4. Load that exact extracted folder in contained Chromium.
5. Open the real popup and options page.

Keep a separate source ZIP when tests, documentation, and development files should not ship in the install package.

## 12. Release checklist

- [ ] Manifest parses and uses MV3.
- [ ] Permissions are minimal.
- [ ] Icons exist at 16, 32, 48, and 128 pixels.
- [ ] Service-worker listeners survive restart assumptions.
- [ ] Protected tabs are never closed or regrouped automatically.
- [ ] Commands have explicit macOS bindings.
- [ ] Feature tests pass.
- [ ] Real-browser E2E tests pass in containment.
- [ ] The exact install ZIP passes an unpacked-load smoke test.
- [ ] `manifest.json` is at the install ZIP root.
- [ ] Installation and shortcut-conflict instructions are current.
- [ ] Generated profiles, dependencies, reports, and videos are excluded from Git.
- [ ] Source is committed and pushed before installation into a daily-use profile.

## Official references

- [Chrome Extensions documentation](https://developer.chrome.com/docs/extensions/)
- [Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [Respond to commands](https://developer.chrome.com/docs/extensions/develop/ui/respond-to-commands)
- [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
