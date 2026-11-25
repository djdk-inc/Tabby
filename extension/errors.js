// Errors that explain a normal situation to the user (missing permission, stale page).
// They are shown, not logged as bugs.
export class UserFacingError extends Error {}

// Extension pages forward their own uncaught errors to the worker's error log.
export function reportPageErrors(page) {
  const send = (error) => chrome.runtime.sendMessage({
    type: "log-error", source: `page:${page}`, message: String(error?.message || error), stack: error?.stack || null
  }).catch(() => {});
  addEventListener("error", (event) => send(event.error || event.message));
  addEventListener("unhandledrejection", (event) => send(event.reason));
}
