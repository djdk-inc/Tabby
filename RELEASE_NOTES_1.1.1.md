# Tabby 1.1.1

Tabby 1.1.1 is the stable public release of the consolidated Manifest V3 tab-management extension.

## Highlights

- **Organize now** merges normal windows, removes canonical URL duplicates, organizes tabs into alphabetical native groups, and evaluates inactive-group collapse in one action.
- `Command+Shift+X` runs the complete workflow on macOS (`Ctrl+Shift+X` on Windows and Linux).
- Saved tabs are canonical-URL-deduplicated and displayed as one alphabetical list.
- Sessions can be saved, restored, and exported as JSON or CSV.
- Pinned and audible tabs are protected from automatic closing and regrouping.
- Configurable focus hours can limit selected domains to 3 regular tabs across all normal windows, with a safe decision page for a fourth tab.
- Known sites use compact text symbols such as `𝕏`; Chrome does not expose a supported native tab-group favicon API.

## Verification

- 9/9 feature and unit tests passed.
- 15/15 real-browser end-to-end tests passed in an isolated headed Chromium profile with the actual MV3 extension loaded.
- A separate fresh-profile browser exercise passed cross-window focus counting, the fourth-tab decision flow, explicit bypass, pinned-tab protection, and schedule boundaries.
- The exact installation ZIP was extracted and loaded into Chromium before publication.

See `TEST_REPORT.md` for the full evidence and known boundaries.
