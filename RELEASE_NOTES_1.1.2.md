# Tabby 1.1.2

Patch release: fixes window merging with incognito windows and reworks the Sessions view.

## Fixes

- **Merge windows** no longer fails with "Tabs can only be moved between windows in the same profile" when an incognito window is open. Windows merge like with like: regular windows into the current window, incognito windows into one incognito window.

## Changes

- Sessions save whether each window was incognito. **Restore** reopens every window in its saved mode; a window's **Open** reopens just that window.
- The Sessions tab is compact: each session expands into its windows, and each window into its URLs.
- Restoring incognito windows requires **Allow in Incognito** for Tabby; without it Tabby shows a clear message. Sessions saved before 1.1.2 restore as regular windows.

## Verification

- 10/10 unit tests passed.
- 15/15 real-browser E2E tests passed in new headless Chromium against the extracted install ZIP (audible-tab test runs headed only).
