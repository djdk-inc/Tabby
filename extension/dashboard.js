import { DEFAULTS, normalizeFocusDomains, savedUrls } from "./core.js";
import { reportPageErrors } from "./errors.js";
reportPageErrors("dashboard");
import { savedToCsv, sessionsToCsv } from "./export.js";
import { reloadIfFolderUpdated } from "./self-update.js";
reloadIfFolderUpdated();
const $ = (s) => document.querySelector(s);
function showTab(name) {
  if (!document.querySelector(`[data-tab="${name}"]`)) return;
  document.querySelectorAll("[data-tab],.panel").forEach((e) => e.classList.remove("active"));
  document.querySelector(`[data-tab="${name}"]`).classList.add("active"); $(`#${name}`).classList.add("active");
}
document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { showTab(b.dataset.tab); history.replaceState(null, "", `#${b.dataset.tab}`); });
showTab(location.hash.slice(1));
async function act(type, extra = {}) { const r = await chrome.runtime.sendMessage({ type, ...extra }); if (!r.ok) throw new Error(r.error); await render(); return r; }
$("#saveSession").onclick = () => act("save-session");
$("#exportSessionsCsv").onclick = async () => {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  if (sessions.length) downloadCsv(sessionsToCsv(sessions), "tabby-sessions");
};
$("#exportSavedCsv").onclick = async () => {
  const data = await chrome.storage.local.get(["sessions", "settings"]);
  const cfg = { ...DEFAULTS, ...(data.settings || {}) };
  const saved = savedUrls(data.sessions || [], savedFilter, cfg.stripTracking);
  if (saved.length) downloadCsv(savedToCsv(saved), savedFilter === "all" ? "tabby-saved" : `tabby-saved-${savedFilter}`);
};
let savedFilter = "all";
document.querySelectorAll("[data-saved-filter]").forEach((b) => b.onclick = () => {
  savedFilter = b.dataset.savedFilter;
  document.querySelectorAll("[data-saved-filter]").forEach((x) => x.classList.toggle("active", x === b));
  render();
});
async function render() {
  const data = await chrome.storage.local.get(["sessions", "settings"]); const sessions = data.sessions || [];
  const cfg0 = { ...DEFAULTS, ...(data.settings || {}) };
  const saved = savedUrls(sessions, savedFilter, cfg0.stripTracking);
  $("#savedCount").textContent = `${saved.length} URL${saved.length === 1 ? "" : "s"}`;
  // Opens in incognito only when the URL was never saved from a regular window.
  $("#savedList").innerHTML = saved.length ? saved.map((e) => `<li><a href="${esc(e.url)}" data-session-url data-incognito="${e.incognito && !e.regular}" title="${esc(e.title)}">${esc(e.url)}</a>${e.incognito ? `<span class="badge">Incognito</span>` : ""}</li>`).join("") : `<li class="muted">No saved URLs${savedFilter === "all" ? "" : ` from ${savedFilter} windows`}.</li>`;
  const openKeys = new Set([...document.querySelectorAll("#sessionList details[open]")].map((d) => d.dataset.key));
  $("#sessionList").innerHTML = sessions.length ? sessions.map(sessionHtml).join("") : `<div class="card muted">No sessions yet.</div>`;
  document.querySelectorAll("#sessionList details").forEach((d) => { d.open = openKeys.has(d.dataset.key); });
  // Buttons sit inside <summary>; stop the click from also toggling the row.
  const onButton = (sel, fn) => document.querySelectorAll(sel).forEach((b) => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); $("#sessionStatus").textContent = ""; fn(b.dataset).catch(showSessionError); });
  onButton("[data-restore]", (d) => act("restore-session", { id:d.restore }));
  onButton("[data-restore-window]", (d) => act("restore-window", { id:d.restoreWindow, index:Number(d.index) }));
  onButton("[data-del-session]", (d) => act("delete-session", { id:d.delSession }));
  document.querySelectorAll("[data-session-url]").forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    const url = a.getAttribute("href");
    (a.dataset.incognito === "true" ? chrome.windows.create({ url, incognito:true }) : chrome.tabs.create({ url })).catch(showSessionError);
  });
  const cfg = { ...DEFAULTS, ...(data.settings || {}) };
  document.querySelectorAll("[data-setting]").forEach((el) => {
    const value = cfg[el.dataset.setting];
    el.type === "checkbox" ? el.checked = value : el.value = Array.isArray(value) ? value.join("\n") : value;
  });
  document.querySelectorAll("[data-focus-day]").forEach((el) => { el.checked = cfg.focusDays.includes(Number(el.dataset.focusDay)); });
}
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
function showSessionError(err) { $("#sessionStatus").textContent = err.message; }
function windowHtml(sessionId, w, i) {
  const urls = w.tabs.map((t) => `<li><a href="${esc(t.url)}" data-session-url data-incognito="${Boolean(w.incognito)}" title="${esc(t.title || t.url)}">${esc(t.url)}</a></li>`).join("");
  return `<details class="window" data-key="${esc(sessionId)}:${i}"><summary><span class="caret"></span><span>Window ${i + 1}</span>${w.incognito ? `<span class="badge">Incognito</span>` : ""}<span class="muted">${plural(w.tabs.length, "tab")}</span><span class="spacer"></span><button class="small" data-restore-window="${esc(sessionId)}" data-index="${i}">Open</button></summary><ul class="url-list">${urls}</ul></details>`;
}
function sessionHtml(x) {
  const date = new Date(x.createdAt).toLocaleString();
  const tabCount = x.windows.reduce((n, w) => n + w.tabs.length, 0);
  const meta = [plural(x.windows.length, "window"), plural(tabCount, "tab"), x.name.includes(date) ? "" : date].filter(Boolean).join(" · ");
  return `<details class="card session" data-key="${esc(x.id)}"><summary><span class="caret"></span><strong>${esc(x.name)}</strong><span class="muted">${meta}</span><span class="spacer"></span><button class="small" data-restore="${esc(x.id)}">Restore</button><button class="small danger" data-del-session="${esc(x.id)}">Remove</button></summary>${x.windows.map((w, i) => windowHtml(x.id, w, i)).join("")}</details>`;
}
function downloadCsv(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" })); const link = document.createElement("a");
  link.href = url; link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function saveSetting(key, value) {
  const data = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings:{ ...DEFAULTS, ...(data.settings || {}), [key]:value } });
  $("#settingsStatus").textContent = "Saved.";
}
document.querySelectorAll("[data-setting]").forEach((el) => el.onchange = async () => {
  let value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
  if (el.dataset.setting === "focusDomains") value = normalizeFocusDomains(value);
  await saveSetting(el.dataset.setting, value);
  if (el.dataset.setting === "focusDomains") el.value = value.join("\n");
});
document.querySelectorAll("[data-focus-day]").forEach((el) => el.onchange = async () => {
  const days = [...document.querySelectorAll("[data-focus-day]:checked")].map((day) => Number(day.dataset.focusDay));
  await saveSetting("focusDays", days);
});
function esc(s="") { return s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
render();
