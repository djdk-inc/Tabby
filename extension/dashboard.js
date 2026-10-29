import { DEFAULTS } from "./core.js";
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
  $("#sessionList").innerHTML = sessions.length ? sessions.map((x) => `<article class="card row"><div><strong>${esc(x.name)}</strong><div class="muted">${x.windows.length} window(s) · ${new Date(x.createdAt).toLocaleString()}</div></div><div><button data-restore="${x.id}">Restore</button> <button class="danger" data-del-session="${x.id}">Remove</button></div></article>`).join("") : `<div class="card muted">No sessions yet.</div>`;
  document.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => chrome.tabs.create({ url: b.dataset.open }));
  document.querySelectorAll("[data-del-lib]").forEach((b) => b.onclick = () => act("delete-library", { id:b.dataset.delLib }));
  document.querySelectorAll("[data-restore]").forEach((b) => b.onclick = () => act("restore-session", { id:b.dataset.restore }));
  document.querySelectorAll("[data-del-session]").forEach((b) => b.onclick = () => act("delete-session", { id:b.dataset.delSession }));
  const cfg = { ...DEFAULTS, ...(data.settings || {}) }; document.querySelectorAll("[data-setting]").forEach((el) => { el.type === "checkbox" ? el.checked = cfg[el.dataset.setting] : el.value = cfg[el.dataset.setting]; });
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
document.querySelectorAll("[data-setting]").forEach((el) => el.onchange = async () => { const data = await chrome.storage.local.get("settings"); const value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value; await chrome.storage.local.set({ settings:{ ...DEFAULTS, ...(data.settings || {}), [el.dataset.setting]:value } }); $("#settingsStatus").textContent = "Saved."; });
function esc(s="") { return s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
render();
