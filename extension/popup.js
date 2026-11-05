const status = document.querySelector("#status");
const focusStatus = document.querySelector("#focusStatus");
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
  status.textContent = "Working…";
  const result = await chrome.runtime.sendMessage({ type: button.dataset.action });
  status.textContent = result.ok ? summary(button.dataset.action, result) : `Could not complete: ${result.error}`;
}));
function summary(action, r) {
  return ({ "organize-all":`Merged ${r.windows} windows, removed ${r.removed} duplicates, organized ${r.tabs} tabs, and collapsed ${r.collapsed} groups.`, organize:`Organized ${r.tabs} tabs into ${r.groups} groups.`, dedupe:`Removed ${r.removed} duplicate tabs.`, merge:`Merged ${r.windows} windows and moved ${r.moved} tabs.`, "save-tabs":`Library now has ${r.saved} tabs.`, "save-session":"Session saved.", collapse:`Collapsed ${r.collapsed} groups.` })[action] || "Done.";
}
chrome.runtime.sendMessage({ type:"focus-status" }).then((result) => {
  if (!result.ok) return;
  focusStatus.textContent = !result.enabled
    ? "Focus tab limits are off. Configure them in Settings."
    : result.active
      ? `Focus hours are active: up to ${result.limit} tabs per limited domain across all windows.`
      : `Focus tab limits are scheduled for ${result.start}–${result.end} local time.`;
});
