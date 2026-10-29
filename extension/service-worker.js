import { DEFAULTS, canonicalUrl, chooseDuplicateKeeper, groupLabel, groupTitle, isProtected, isWebUrl } from "./core.js";

const COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];
let organizing = new Set();
const collapseTimers = new Map();
const activationQueues = new Map();

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get("settings")).settings };
}

async function initialize() {
  const data = await chrome.storage.local.get(["settings", "library", "sessions"]);
  await chrome.storage.local.set({
    settings: { ...DEFAULTS, ...(data.settings || {}) },
    library: data.library || [],
    sessions: data.sessions || []
  });
  const activeTabs = await chrome.tabs.query({ active:true, windowType:"normal" });
  await chrome.storage.session.set({ activeGroupByWindow:Object.fromEntries(activeTabs.map((tab) => [tab.windowId, tab.groupId])) });
  await chrome.alarms.create("inactive-collapse", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

async function organizeWindow(windowId) {
  if (!windowId || organizing.has(windowId)) return { groups: 0, tabs: 0 };
  organizing.add(windowId);
  try {
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
      const groupId = await chrome.tabs.group(prior ? { tabIds, groupId: prior.id } : { tabIds });
      await chrome.tabGroups.update(groupId, { title: label, color: COLORS[i % COLORS.length] });
    }
    const pinnedCount = tabs.filter((tab) => tab.pinned).length;
    const groups = await chrome.tabGroups.query({ windowId });
    groups.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    let nextIndex = pinnedCount;
    for (const group of groups) {
      await chrome.tabGroups.move(group.id, { index: nextIndex });
      nextIndex += (await chrome.tabs.query({ groupId: group.id })).length;
    }
    return { groups: groups.length, tabs: [...buckets.values()].reduce((n, ids) => n + ids.length, 0) };
  } finally {
    organizing.delete(windowId);
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
  const wins = (await chrome.windows.getAll({ windowTypes: ["normal"], populate: true })).filter((w) => w.id !== targetWindowId);
  let moved = 0;
  for (const win of wins) {
    const tabs = win.tabs || [];
    const pinned = tabs.filter((t) => t.pinned);
    const regular = tabs.filter((t) => !t.pinned);
    for (const tab of pinned) {
      await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
      await chrome.tabs.update(tab.id, { pinned: true, muted: tab.mutedInfo?.muted });
      moved++;
    }
    if (regular.length) {
      await chrome.tabs.move(regular.map((t) => t.id), { windowId: targetWindowId, index: -1 });
      moved += regular.length;
    }
  }
  await organizeWindow(targetWindowId);
  return { windows: wins.length, moved };
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
    windows: windows.map((w) => ({ tabs: (w.tabs || []).filter((t) => isWebUrl(t.url)).map((t) => ({
      url: t.url, title: t.title, pinned: t.pinned, muted: t.mutedInfo?.muted || false,
      group: groups.find((g) => g.id === t.groupId)?.title || null
    })) }))
  };
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  await chrome.storage.local.set({ sessions: [session, ...sessions] });
  return session;
}

async function restoreSession(id) {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const session = sessions.find((s) => s.id === id);
  if (!session) throw new Error("Session not found");
  const created = [];
  for (const [index, savedWindow] of session.windows.entries()) {
    const urls = savedWindow.tabs.map((t) => t.url);
    if (!urls.length) continue;
    const win = await chrome.windows.create({ url: urls, focused: index === 0 });
    const tabs = await chrome.tabs.query({ windowId: win.id });
    for (let i = 0; i < tabs.length; i++) await chrome.tabs.update(tabs[i].id, { pinned: savedWindow.tabs[i]?.pinned || false, muted: savedWindow.tabs[i]?.muted || false });
    await organizeWindow(win.id);
    created.push(win.id);
  }
  return { windows: created.length };
}

async function saveTabs(tabIds) {
  const tabs = tabIds?.length ? await Promise.all(tabIds.map((id) => chrome.tabs.get(id))) : await chrome.tabs.query({ currentWindow: true });
  const cfg = await settings();
  const { library = [] } = await chrome.storage.local.get("library");
  const byUrl = new Map(library.filter((item) => isWebUrl(item.url)).map((item) => [canonicalUrl(item.url, cfg.stripTracking), item]));
  for (const tab of tabs.filter((t) => isWebUrl(t.url))) {
    const key = canonicalUrl(tab.url, cfg.stripTracking);
    const prior = byUrl.get(key);
    byUrl.set(key, {
      id: prior?.id || crypto.randomUUID(), url: tab.url, title: tab.title || tab.url,
      domain: groupLabel(tab.url, "domain"), savedAt: Date.now()
    });
  }
  const result = [...byUrl.values()].sort((a, b) =>
    (a.title || a.url).localeCompare(b.title || b.url) || a.url.localeCompare(b.url)
  );
  await chrome.storage.local.set({ library: result });
  return { saved: result.length };
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
      case "save-tabs": return saveTabs(message.tabIds);
      case "save-session": return saveCurrentSession(message.name);
      case "restore-session": return restoreSession(message.id);
      case "delete-library": {
        const { library = [] } = await chrome.storage.local.get("library");
        await chrome.storage.local.set({ library: library.filter((x) => x.id !== message.id) }); return { deleted: 1 };
      }
      case "delete-session": {
        const { sessions = [] } = await chrome.storage.local.get("sessions");
        await chrome.storage.local.set({ sessions: sessions.filter((x) => x.id !== message.id) }); return { deleted: 1 };
      }
      default: throw new Error(`Unknown action: ${message.type}`);
    }
  })().then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!change.url && change.status !== "complete") return;
  const cfg = await settings();
  if (cfg.dedupeOnNavigate && tab.windowId) await dedupeWindow(tab.windowId);
  if (cfg.autoOrganize && tab.windowId) await organizeWindow(tab.windowId);
});
chrome.tabs.onCreated.addListener(async (tab) => { const cfg = await settings(); if (cfg.autoOrganize && tab.windowId) setTimeout(() => organizeWindow(tab.windowId), 600); });
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
chrome.tabs.onActivated.addListener((info) => {
  const prior = activationQueues.get(info.windowId) || Promise.resolve();
  const next = prior.then(() => handleTabActivated(info)).catch(() => {});
  activationQueues.set(info.windowId, next);
  next.finally(() => { if (activationQueues.get(info.windowId) === next) activationQueues.delete(info.windowId); });
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "inactive-collapse") collapseInactiveGroups(); });
chrome.commands.onCommand.addListener(async (command) => {
  const win = await chrome.windows.getCurrent();
  if (command === "organize-tabs") await organizeEverything(win.id);
});
