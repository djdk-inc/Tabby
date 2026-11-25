import { DEFAULTS, normalizeFocusDomains } from "./core.js";
import { reportPageErrors } from "./errors.js";
reportPageErrors("dashboard");
import { sessionsToCsv, sessionsToJson } from "./export.js";
const $ = (s) => document.querySelector(s);
document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { document.querySelectorAll("[data-tab],.panel").forEach((e) => e.classList.remove("active")); b.classList.add("active"); $(`#${b.dataset.tab}`).classList.add("active"); });
async function act(type, extra = {}) { const r = await chrome.runtime.sendMessage({ type, ...extra }); if (!r.ok) throw new Error(r.error); await render(); return r; }
$("#saveOpen").onclick = () => act("save-tabs"); $("#saveSession").onclick = () => act("save-session");
$("#exportSessionsJson").onclick = () => exportSessions("json");
$("#exportSessionsCsv").onclick = () => exportSessions("csv");
async function render() {
  const data = await chrome.storage.local.get(["library", "sessions", "settings"]); const library = data.library || []; const sessions = data.sessions || [];
  $("#libraryList").innerHTML = library.length ? library.map((x) => `<article class="card row"><div><strong>${esc(x.title)}</strong><div class="url">${esc(x.url)}</div></div><div><button data-open="${esc(x.url)}">Open</button> <button class="danger" data-del-lib="${x.id}">Remove</button></div></article>`).join("") : `<div class="card muted">No saved tabs yet.</div>`;
  const openKeys = new Set([...document.querySelectorAll("#sessionList details[open]")].map((d) => d.dataset.key));
  $("#sessionList").innerHTML = sessions.length ? sessions.map(sessionHtml).join("") : `<div class="card muted">No sessions yet.</div>`;
  document.querySelectorAll("#sessionList details").forEach((d) => { d.open = openKeys.has(d.dataset.key); });
  document.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => chrome.tabs.create({ url: b.dataset.open }));
  document.querySelectorAll("[data-del-lib]").forEach((b) => b.onclick = () => act("delete-library", { id:b.dataset.delLib }));
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
async function exportSessions(format) {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  if (!sessions.length) return;
  const text = format === "json" ? sessionsToJson(sessions) : sessionsToCsv(sessions);
  const blob = new Blob([text], { type:format === "json" ? "application/json" : "text/csv" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `tabby-sessions-${new Date().toISOString().slice(0, 10)}.${format}`; link.click();
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
