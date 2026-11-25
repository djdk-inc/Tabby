import { reportPageErrors } from "./errors.js";
reportPageErrors("popup");
const status = document.querySelector("#status");
const focusStatus = document.querySelector("#focusStatus");
// Organize = merge windows, remove duplicates, group and sort, collapse inactive groups.
document.querySelector("#organize").addEventListener("click", async () => {
  status.textContent = "Working…";
  const r = await chrome.runtime.sendMessage({ type: "organize-all" });
  status.textContent = r.ok
    ? `Merged ${r.windows} windows, removed ${r.removed} duplicates, organized ${r.tabs} tabs, and collapsed ${r.collapsed} groups.`
    : `Could not complete: ${r.error}`;
});
document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#${button.dataset.open}`) });
  window.close();
}));
chrome.runtime.sendMessage({ type:"focus-status" }).then((result) => {
  if (!result.ok) return;
  focusStatus.textContent = !result.enabled
    ? "Focus tab limits are off. Configure them in Settings."
    : result.active
      ? `Focus hours are active: up to ${result.limit} tabs per limited domain across all windows.`
      : `Focus limits are on but not active right now (${scheduleText(result)}). Change hours in Settings.`;
});
function scheduleText({ start, end, days }) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayText = days.length === 7 ? "every day" : days.length ? days.map((d) => names[d]).join(", ") : "no days";
  return `${start === end ? "all day" : `${start}–${end}`}, ${dayText}`;
}
