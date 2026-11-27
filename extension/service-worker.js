import {
  DEFAULTS, FOCUS_TAB_LIMIT, adjacentTabId, canonicalUrl, chooseDuplicateKeeper, groupLabel, groupTitle,
  addToErrorLog, focusLimitExceeded, groupsInOrder, upgradeFocusDefaults, isFocusScheduleActive, isProtected, isWebUrl, mergePlan, restrictedDomainForUrl, tabDestination
} from "./core.js";
import { UserFacingError } from "./errors.js";
import { reloadIfFolderUpdated } from "./self-update.js";

const COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];
const organizing = new Map();
const collapseTimers = new Map();
const activationQueues = new Map();
let focusLimitQueue = Promise.resolve();

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get("settings")).settings };
}

async function initialize() {
  const activeTabs = await chrome.tabs.query({ active:true, windowType:"normal" });
  await chrome.storage.session.set({ activeGroupByWindow:Object.fromEntries(activeTabs.map((tab) => [tab.windowId, tab.groupId])) });
  await chrome.alarms.create("inactive-collapse", { periodInMinutes: 1 });
}

async function focusStatus(cfg = null, now = new Date()) {
  const current = cfg || await settings();
  return {
    enabled: Boolean(current.focusLimitEnabled),
    active: Boolean(current.focusLimitEnabled && isFocusScheduleActive(now, current.focusStart, current.focusEnd, current.focusDays)),
    limit: FOCUS_TAB_LIMIT,
    start: current.focusStart,
    end: current.focusEnd,
    days: current.focusDays,
    domains: current.focusDomains
  };
}

// Each tab's limited domain as last seen (null when on none), so a tab moving around inside a
// domain is told apart from one entering it. Session storage survives service-worker restarts.
// A tab with no entry yet is one this worker never saw open; its first navigation is only recorded.
async function enforceTabLimit(tab, { created = false } = {}) {
  if (!tab?.id) return { closed: false };
  const cfg = await settings();
  const { focusTabDomains = {} } = await chrome.storage.session.get("focusTabDomains");
  const known = Object.hasOwn(focusTabDomains, tab.id);
  const prior = focusTabDomains[tab.id];
  focusTabDomains[tab.id] = restrictedDomainForUrl(tabDestination(tab), cfg.focusDomains);
  await chrome.storage.session.set({ focusTabDomains });
  if (!created && !known) return { closed: false };
  if (!(await focusStatus(cfg)).active) return { closed: false };
  const domain = focusLimitExceeded(tab, prior, await chrome.tabs.query({ windowType: "normal" }), cfg.focusDomains);
  if (!domain) return { closed: false };
  await unlessStripChanged(() => chrome.tabs.remove(tab.id));
  return { closed: true, domain };
}

// Checks run one at a time in event order, so a burst of new tabs sees each earlier close.
function queueFocusLimitCheck(tab, options) {
  const next = focusLimitQueue.then(() => enforceTabLimit(tab, options));
  focusLimitQueue = next.catch(() => {});
  return next;
}

chrome.runtime.onInstalled.addListener(initialize);
// One-time settings migration, run whenever the worker starts until it has run once. Not tied to
// onInstalled, which Chrome does not fire for every way an unpacked folder gets updated.
inBackground(chrome.storage.local.get(["settings", "migrations"]).then(({ settings, migrations = {} }) => {
  if (migrations.focusDefaults21) return;
  const upgraded = upgradeFocusDefaults(settings);
  return chrome.storage.local.set({ ...(upgraded !== settings ? { settings: upgraded } : {}), migrations: { ...migrations, focusDefaults21: true } });
}));
chrome.runtime.onStartup.addListener(initialize);

// Tabs and groups can change while Tabby works (user closes a tab, a duplicate is removed,
// a link opens into a group). These Chrome errors mean "the strip moved under us"; the
// next organize pass converges, so the step is skipped instead of failing the whole run.
const TAB_STRIP_RACES = ["No tab with id", "No group with id", "No window with id", "in the middle of another group", "Tabs cannot be edited right now"];
async function unlessStripChanged(step) {
  try { return await step(); } catch (error) {
    if (TAB_STRIP_RACES.some((text) => String(error?.message).includes(text))) return null;
    throw error;
  }
}
// Error log: every unexpected failure is kept in storage and mirrored to
// <Downloads>/tabby_errors.json so known errors can be fixed later.
const ERROR_FILE = "tabby_errors.json";
const VERSION = chrome.runtime.getManifest().version;
let errorLogQueue = Promise.resolve();
let errorFileTimer = null;
const erasingDownloads = new Set();

function recordError(error, source) {
  if (error instanceof UserFacingError) return;
  const entry = { message: String(error?.message || error), source, stack: error?.stack || null, version: VERSION };
  console.warn(`Tabby error (${source}):`, entry.message);
  errorLogQueue = errorLogQueue.then(async () => {
    const { errorLog = [] } = await chrome.storage.local.get("errorLog");
    await chrome.storage.local.set({ errorLog: addToErrorLog(errorLog, entry, new Date().toISOString()) });
    clearTimeout(errorFileTimer);
    errorFileTimer = setTimeout(() => writeErrorFile().catch((e) => console.warn("Tabby could not write error file:", e?.message)), 2000);
  }).catch(() => {});
  return errorLogQueue;
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function writeErrorFile() {
  const { errorLog = [] } = await chrome.storage.local.get("errorLog");
  const body = JSON.stringify({ extension: "Tabby", version: VERSION, updatedAt: new Date().toISOString(), errors: errorLog }, null, 2);
  const id = await chrome.downloads.download({
    url: `data:application/json;base64,${base64(body)}`, filename: ERROR_FILE, conflictAction: "overwrite", saveAs: false
  });
  erasingDownloads.add(id);
  return id;
}

// Keep the file but drop it from Chrome's download history.
chrome.downloads.onChanged.addListener((delta) => {
  if (!erasingDownloads.has(delta.id) || delta.state?.current !== "complete") return;
  erasingDownloads.delete(delta.id);
  chrome.downloads.erase({ id: delta.id });
});

// A new version starts a fresh log: fixed errors disappear, unfixed ones get logged again.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== "update") return;
  inBackground(chrome.storage.local.set({ errorLog: [] }).then(writeErrorFile));
});

self.addEventListener("unhandledrejection", (event) => recordError(event.reason, "unhandled"));
self.addEventListener("error", (event) => recordError(event.error || event.message, "uncaught"));

// Background listeners are best-effort; failures go to the error log, never uncaught.
function inBackground(promise, source = "background") {
  promise.catch((error) => recordError(error, source));
}

async function organizeWindow(windowId) {
  if (!windowId) return { groups: 0, tabs: 0 };
  if (organizing.has(windowId)) return organizing.get(windowId);
  const task = (async () => {
    const cfg = await settings();
    const tabs = await chrome.tabs.query({ windowId });
    const buckets = new Map();
    for (const tab of tabs) {
      if (!tab.id || !isWebUrl(tab.url) || isProtected(tab, cfg)) continue;
      const label = groupTitle(tab.url, cfg.groupingMode, cfg.useSiteIcons);
      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label).push(tab.id);
    }
    const existing = new Map((await chrome.tabGroups.query({ windowId })).map((g) => [g.title, g]));
    const sorted = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < sorted.length; i++) {
      const [label, tabIds] = sorted[i];
      const prior = existing.get(label);
      await unlessStripChanged(async () => {
        // Without createProperties.windowId Chrome creates the group in the focused window and moves the
        // tabs there (across profiles that throws "Tabs can only be moved between windows in the same profile").
        const groupId = await chrome.tabs.group(prior ? { tabIds, groupId: prior.id } : { tabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { title: label, color: COLORS[i % COLORS.length] });
      });
    }
    // Alphabetical order: move groups last-to-first to just after the pinned tabs. That spot is
    // always a group boundary, so no index is precomputed against a strip that may change.
    const groups = await chrome.tabGroups.query({ windowId });
    const titleOf = new Map(groups.map((g) => [g.id, g.title]));
    // Leave an already-sorted strip alone so repeated passes never visibly reshuffle tabs.
    if (groupsInOrder(await chrome.tabs.query({ windowId }), (id) => titleOf.get(id))) return { groups: groups.length, tabs: [...buckets.values()].reduce((n, ids) => n + ids.length, 0) };
    groups.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    for (const group of groups) {
      await unlessStripChanged(async () => {
        const pinned = (await chrome.tabs.query({ windowId, pinned: true })).length;
        await chrome.tabGroups.move(group.id, { index: pinned });
      });
    }
    return { groups: groups.length, tabs: [...buckets.values()].reduce((n, ids) => n + ids.length, 0) };
  })();
  organizing.set(windowId, task);
  try {
    return await task;
  } finally {
    if (organizing.get(windowId) === task) organizing.delete(windowId);
  }
}

async function dedupeWindow(windowId) {
  const cfg = await settings();
  const tabs = await chrome.tabs.query({ windowId });
  const buckets = new Map();
  for (const tab of tabs) {
    if (!tab.id || !isWebUrl(tab.url)) continue;
    const key = canonicalUrl(tab.url, cfg.stripTracking);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab);
  }
  const remove = [];
  for (const same of buckets.values()) {
    if (same.length < 2) continue;
    const keep = chooseDuplicateKeeper(same, cfg);
    remove.push(...same.filter((tab) => tab.id !== keep.id && !isProtected(tab, cfg)).map((tab) => tab.id));
  }
  if (remove.length) await chrome.tabs.remove(remove);
  return { removed: remove.length };
}

async function collapseInactiveGroups() {
  const cfg = await settings();
  if (!cfg.collapseInactive) return { collapsed: 0 };
  const cutoff = Date.now() - cfg.inactiveMinutes * 60_000;
  let collapsed = 0;
  for (const group of await chrome.tabGroups.query({})) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (!group.collapsed && tabs.length && tabs.every((tab) => !tab.active && (tab.lastAccessed || 0) < cutoff)) {
      await chrome.tabGroups.update(group.id, { collapsed: true });
      collapsed++;
    }
  }
  return { collapsed };
}

async function mergeWindows(targetWindowId) {
  const target = await chrome.windows.get(targetWindowId);
  const plan = mergePlan(await chrome.windows.getAll({ windowTypes: ["normal"], populate: true }), target);
  let moved = 0, windows = 0;
  for (const { targetId, sources } of plan) {
    for (const win of sources) {
      const tabs = win.tabs || [];
      const pinned = tabs.filter((t) => t.pinned);
      const regular = tabs.filter((t) => !t.pinned);
      for (const tab of pinned) {
        await chrome.tabs.move(tab.id, { windowId: targetId, index: -1 });
        await chrome.tabs.update(tab.id, { pinned: true, muted: tab.mutedInfo?.muted });
        moved++;
      }
      if (regular.length) {
        await chrome.tabs.move(regular.map((t) => t.id), { windowId: targetId, index: -1 });
        moved += regular.length;
      }
      windows++;
    }
    if (targetId !== targetWindowId) await organizeWindow(targetId);
  }
  await organizeWindow(targetWindowId);
  return { windows, moved };
}

async function organizeEverything(windowId) {
  const merged = await mergeWindows(windowId);
  const deduped = await dedupeWindow(windowId);
  const organized = await organizeWindow(windowId);
  const collapsed = await collapseInactiveGroups();
  return { ...merged, ...deduped, ...organized, ...collapsed };
}

async function saveCurrentSession(name) {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
  const groups = await chrome.tabGroups.query({});
  const session = {
    id: crypto.randomUUID(), name: name || `Session ${new Date().toLocaleString()}`, createdAt: Date.now(),
    windows: windows.map((w) => ({ incognito: w.incognito, tabs: (w.tabs || []).filter((t) => isWebUrl(t.url)).map((t) => ({
      url: t.url, title: t.title, pinned: t.pinned, muted: t.mutedInfo?.muted || false,
      group: groups.find((g) => g.id === t.groupId)?.title || null
    })) }))
  };
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  await chrome.storage.local.set({ sessions: [session, ...sessions] });
  return session;
}

async function findSession(id) {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const session = sessions.find((s) => s.id === id);
  if (!session) throw new UserFacingError("Session not found");
  return session;
}

// Reopens a saved window in the mode it was saved in (incognito or regular).
async function restoreWindow(savedWindow, focused) {
  const urls = savedWindow.tabs.map((t) => t.url);
  if (!urls.length) return null;
  if (savedWindow.incognito && !(await chrome.extension.isAllowedIncognitoAccess())) {
    throw new UserFacingError("Allow Tabby in Incognito (chrome://extensions → Tabby → Details) to restore incognito windows.");
  }
  const win = await chrome.windows.create({ url: urls, focused, incognito: Boolean(savedWindow.incognito) });
  const tabs = await chrome.tabs.query({ windowId: win.id });
  for (let i = 0; i < tabs.length; i++) await chrome.tabs.update(tabs[i].id, { pinned: savedWindow.tabs[i]?.pinned || false, muted: savedWindow.tabs[i]?.muted || false });
  await organizeWindow(win.id);
  return win.id;
}

async function restoreSession(id) {
  const session = await findSession(id);
  const created = [];
  for (const [index, savedWindow] of session.windows.entries()) {
    const winId = await restoreWindow(savedWindow, index === 0);
    if (winId) created.push(winId);
  }
  return { windows: created.length };
}

async function restoreSessionWindow(id, index) {
  const savedWindow = (await findSession(id)).windows[index];
  if (!savedWindow) throw new UserFacingError("Window not found");
  return { windows: (await restoreWindow(savedWindow, true)) ? 1 : 0 };
}

// Activating a tab in a collapsed group expands it; the activation listener collapses the group left behind.
async function cycleTab(windowId, step) {
  const tabs = await chrome.tabs.query({ windowId });
  const target = adjacentTabId(tabs, tabs.find((tab) => tab.active)?.id, step);
  if (target === null) return { activated: null };
  try { await chrome.tabs.update(target, { active:true }); } catch { return { activated: null }; }
  return { activated: target };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const current = sender.tab?.windowId || (await chrome.windows.getCurrent()).id;
    switch (message.type) {
      case "organize-all": return organizeEverything(message.windowId || current);
      case "organize": return organizeWindow(message.windowId || current);
      case "dedupe": return dedupeWindow(message.windowId || current);
      case "merge": return mergeWindows(message.windowId || current);
      case "collapse": return collapseInactiveGroups();
      case "cycle-tab": return cycleTab(message.windowId || current, message.step);
      case "save-session": return saveCurrentSession(message.name);
      case "restore-session": return restoreSession(message.id);
      case "restore-window": return restoreSessionWindow(message.id, message.index);
      case "log-error": await recordError({ message: message.message, stack: message.stack }, message.source || "page"); return {};
      case "focus-status": return focusStatus();
      case "delete-session": {
        const { sessions = [] } = await chrome.storage.local.get("sessions");
        await chrome.storage.local.set({ sessions: sessions.filter((x) => x.id !== message.id) }); return { deleted: 1 };
      }
      default: throw new Error(`Unknown action: ${message.type}`);
    }
  })().then((result) => sendResponse({ ok: true, ...result })).catch((error) => {
    recordError(error, `action:${message.type}`);
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => inBackground((async () => {
  if (!change.url && change.status !== "complete") return;
  if (change.url && (await queueFocusLimitCheck(tab)).closed) return;
  const cfg = await settings();
  if (cfg.dedupeOnNavigate && tab.windowId) await unlessStripChanged(() => dedupeWindow(tab.windowId));
  if (cfg.autoOrganize && tab.windowId) await unlessStripChanged(() => organizeWindow(tab.windowId));
})()));
chrome.tabs.onCreated.addListener((tab) => inBackground((async () => {
  if ((await queueFocusLimitCheck(tab, { created: true })).closed) return;
  const cfg = await settings();
  if (cfg.autoOrganize && tab.windowId) setTimeout(() => inBackground(unlessStripChanged(() => organizeWindow(tab.windowId))), 600);
})()));
chrome.tabs.onRemoved.addListener((tabId) => {
  const cleanup = focusLimitQueue.then(async () => {
    const { focusTabDomains = {} } = await chrome.storage.session.get("focusTabDomains");
    delete focusTabDomains[tabId];
    await chrome.storage.session.set({ focusTabDomains });
  });
  focusLimitQueue = cleanup.catch(() => {});
});
async function handleTabActivated({ tabId, windowId }) {
  const [tab, cfg, stored] = await Promise.all([
    chrome.tabs.get(tabId), settings(), chrome.storage.session.get("activeGroupByWindow")
  ]);
  const activeGroupByWindow = stored.activeGroupByWindow || {};
  const previousGroupId = activeGroupByWindow[windowId];
  if (tab.groupId >= 0) await chrome.tabGroups.update(tab.groupId, { collapsed:false });
  activeGroupByWindow[windowId] = tab.groupId;
  await chrome.storage.session.set({ activeGroupByWindow });
  clearTimeout(collapseTimers.get(windowId));
  if (cfg.collapseOnLeave && Number.isInteger(previousGroupId) && previousGroupId >= 0 && previousGroupId !== tab.groupId) {
    collapseTimers.set(windowId, setTimeout(async () => {
      try {
        const latest = (await chrome.storage.session.get("activeGroupByWindow")).activeGroupByWindow || {};
        const priorTabs = await chrome.tabs.query({ groupId:previousGroupId });
        if (latest[windowId] !== previousGroupId && priorTabs.every((priorTab) => !priorTab.active)) {
          await chrome.tabGroups.update(previousGroupId, { collapsed:true });
        }
      } catch {} finally { collapseTimers.delete(windowId); }
    }, 300));
  }
}
function queueActivation(windowId, work) {
  const prior = activationQueues.get(windowId) || Promise.resolve();
  const next = prior.then(work).catch(() => {});
  activationQueues.set(windowId, next);
  next.finally(() => { if (activationQueues.get(windowId) === next) activationQueues.delete(windowId); });
}
chrome.tabs.onActivated.addListener((info) => queueActivation(info.windowId, () => handleTabActivated(info)));
// The active tab joining a group (Organize, the user dragging it) makes that the group a later switch leaves.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!("groupId" in change) || !tab.active) return;
  queueActivation(tab.windowId, async () => {
    const activeGroupByWindow = (await chrome.storage.session.get("activeGroupByWindow")).activeGroupByWindow || {};
    activeGroupByWindow[tab.windowId] = change.groupId;
    await chrome.storage.session.set({ activeGroupByWindow });
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "inactive-collapse") return;
  inBackground(unlessStripChanged(collapseInactiveGroups));
  reloadIfFolderUpdated();
});
reloadIfFolderUpdated();
// Brief ✓ on the toolbar icon so a keyboard save is visible.
async function flashSaved() {
  await chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
  await chrome.action.setBadgeText({ text: "✓" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

chrome.commands.onCommand.addListener((command) => inBackground((async () => {
  if (command === "organize-tabs") await organizeEverything((await chrome.windows.getCurrent()).id);
  if (command === "save-session") { await saveCurrentSession(); await flashSaved(); }
  if (command === "next-tab") await cycleTab((await chrome.windows.getCurrent()).id, 1);
  if (command === "previous-tab") await cycleTab((await chrome.windows.getCurrent()).id, -1);
})()));
