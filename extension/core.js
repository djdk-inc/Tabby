export const DEFAULTS = {
  autoOrganize: true,
  groupingMode: "domain",
  useSiteIcons: true,
  collapseInactive: true,
  collapseOnLeave: true,
  inactiveMinutes: 30,
  dedupeOnNavigate: true,
  protectPinned: true,
  protectAudible: true,
  stripTracking: true,
  focusLimitEnabled: true,
  focusStart: "00:00",
  focusEnd: "00:00",
  focusDays: [0, 1, 2, 3, 4, 5, 6],
  focusDomains: ["youtube.com", "reddit.com", "x.com", "instagram.com", "tiktok.com"]
};

export const FOCUS_TAB_LIMIT = 3;

// Before 2.1.0 focus limits defaulted to off, 09:00–17:00, weekdays. A schedule still equal to that
// old default was never chosen, so it becomes all day, every day; if the switch was also untouched
// (off), focus turns on. Any customized schedule or an explicit "off" with a custom schedule is kept.
export function upgradeFocusDefaults(settings) {
  if (!settings) return settings;
  const oldSchedule = settings.focusStart === "09:00" && settings.focusEnd === "17:00" && JSON.stringify(settings.focusDays) === "[1,2,3,4,5]";
  if (!oldSchedule) return settings;
  const { focusLimitEnabled, focusStart, focusEnd, focusDays } = DEFAULTS;
  return { ...settings, focusStart, focusEnd, focusDays, focusLimitEnabled: settings.focusLimitEnabled || focusLimitEnabled };
}

const MULTIPART_SUFFIXES = new Set(["co.uk", "org.uk", "com.au", "co.jp", "co.nz", "com.br"]);
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid)$/i;
const SITE_ICONS = new Map([
  ["x.com", "𝕏"],
  ["twitter.com", "𝕏"],
  ["youtube.com", "▶"],
  ["reddit.com", "👽"],
  ["wikipedia.org", "W"],
  ["spotify.com", "♫"],
  ["slack.com", "✣"],
  ["discord.com", "◉"],
  ["instagram.com", "◎"],
  ["tiktok.com", "♪"],
  ["linkedin.com", "in"],
  ["facebook.com", "f"]
]);

// Chrome cannot move tabs between incognito and regular windows, so merge like with like:
// windows of the target's mode go into the target; the other mode goes into its first window.
export function mergePlan(windows, target) {
  const plan = [];
  for (const incognito of [Boolean(target.incognito), !target.incognito]) {
    const same = windows.filter((w) => Boolean(w.incognito) === incognito);
    const into = incognito === Boolean(target.incognito) ? target : same[0];
    const sources = same.filter((w) => w.id !== into?.id);
    if (sources.length) plan.push({ targetId: into.id, sources });
  }
  return plan;
}

export function isWebUrl(url = "") {
  return /^https?:\/\//i.test(url);
}

export function canonicalUrl(raw, stripTracking = true) {
  if (!isWebUrl(raw)) return raw;
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (stripTracking) {
    [...url.searchParams.keys()].forEach((key) => TRACKING.test(key) && url.searchParams.delete(key));
    url.searchParams.sort();
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function groupLabel(raw, mode = "domain") {
  if (!isWebUrl(raw)) return null;
  const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  if (mode === "subdomain" || host === "localhost" || /^\d+(\.\d+){3}$/.test(host)) return host;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const suffix2 = parts.slice(-2).join(".");
  return MULTIPART_SUFFIXES.has(suffix2) ? parts.slice(-3).join(".") : suffix2;
}

export function groupTitle(raw, mode = "domain", useSiteIcons = true) {
  const label = groupLabel(raw, mode);
  if (!label || !useSiteIcons) return label;
  const domain = groupLabel(raw, "domain");
  return SITE_ICONS.get(domain) || label;
}

export function isProtected(tab, settings) {
  return Boolean((settings.protectPinned && tab.pinned) || (settings.protectAudible && tab.audible));
}

export function chooseDuplicateKeeper(tabs, settings) {
  return [...tabs].sort((a, b) =>
    Number(isProtected(b, settings)) - Number(isProtected(a, settings)) ||
    Number(b.active) - Number(a.active) ||
    (b.lastAccessed || 0) - (a.lastAccessed || 0) ||
    a.id - b.id
  )[0];
}

export function normalizeFocusDomains(value = []) {
  const entries = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  return [...new Set(entries.map((entry) => {
    const raw = String(entry || "").trim().toLowerCase();
    if (!raw) return null;
    try {
      return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }).filter(Boolean))];
}

export function restrictedDomainForUrl(raw, domains = []) {
  if (!isWebUrl(raw)) return null;
  const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  return normalizeFocusDomains(domains).find((domain) => host === domain || host.endsWith(`.${domain}`)) || null;
}

// Where a tab is, or is about to be: a tab still loading counts by the URL it is heading to.
export function tabDestination(tab) {
  return tab.pendingUrl || tab.url || "";
}

// A tab that enters a limited domain (it was not already on it) is over the limit when
// FOCUS_TAB_LIMIT other tabs already hold that domain. Every tab counts, pinned and audible
// ones included; navigating within the domain is never limited. Returns the domain, or null.
export function focusLimitExceeded(tab, priorDomain, allTabs, domains, limit = FOCUS_TAB_LIMIT) {
  const domain = restrictedDomainForUrl(tabDestination(tab), domains);
  if (!domain || domain === priorDomain) return null;
  const holding = allTabs.filter((other) => other.id !== tab.id && restrictedDomainForUrl(tabDestination(other), domains) === domain);
  return holding.length >= limit ? domain : null;
}

function minuteOfDay(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function isFocusScheduleActive(now, start = "09:00", end = "17:00", days = [1, 2, 3, 4, 5]) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return false;
  const startMinute = minuteOfDay(start);
  const endMinute = minuteOfDay(end);
  if (startMinute === null || endMinute === null) return false;
  const enabledDays = new Set((Array.isArray(days) ? days : []).map(Number));
  const currentMinute = date.getHours() * 60 + date.getMinutes();
  if (startMinute === endMinute) return enabledDays.has(date.getDay());
  if (startMinute < endMinute) {
    return enabledDays.has(date.getDay()) && currentMinute >= startMinute && currentMinute < endMinute;
  }
  if (currentMinute >= startMinute) return enabledDays.has(date.getDay());
  const previousDay = (date.getDay() + 6) % 7;
  return currentMinute < endMinute && enabledDays.has(previousDay);
}

// True when the strip already reads: pinned tabs, then every group in alphabetical order, then
// ungrouped tabs. Tabs are in strip order; titleOf maps a groupId to its title.
export function groupsInOrder(tabs, titleOf) {
  const seen = []; let ungroupedSeen = false;
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.groupId < 0) { ungroupedSeen = true; continue; }
    if (seen.at(-1) === tab.groupId) continue;
    if (ungroupedSeen || seen.includes(tab.groupId)) return false;
    seen.push(tab.groupId);
  }
  const titles = seen.map(titleOf);
  return titles.every((title, i) => i === 0 || (titles[i - 1] || "").localeCompare(title || "") <= 0);
}

export const ERROR_LOG_LIMIT = 200;

// Adds one error to the log: repeats of the same message from the same source become one
// entry with a count; newest first; capped so the file stays small.
export function addToErrorLog(log, { message, source, stack = null, version }, now, limit = ERROR_LOG_LIMIT) {
  const known = log.find((entry) => entry.message === message && entry.source === source);
  if (known) {
    const updated = { ...known, count: known.count + 1, lastSeen: now, version, stack: stack || known.stack };
    return [updated, ...log.filter((entry) => entry !== known)];
  }
  return [{ message, source, stack, version, count: 1, firstSeen: now, lastSeen: now }, ...log].slice(0, limit);
}

// Every URL saved in any session, once each (same canonical form as duplicate-tab removal),
// sorted alphabetically. `incognito`/`regular` say which kinds of window it was saved from.
// filter: "all" | "incognito" (saved from any incognito window) | "regular" (never saved from one),
// so the two filters split the list with no overlap.
export function savedUrls(sessions, filter = "all", stripTracking = true) {
  const byUrl = new Map();
  for (const session of sessions) for (const win of session.windows) for (const tab of win.tabs) {
    if (!isWebUrl(tab.url)) continue;
    const url = canonicalUrl(tab.url, stripTracking);
    const entry = byUrl.get(url) || { url, title: tab.title || url, incognito: false, regular: false };
    entry[win.incognito ? "incognito" : "regular"] = true;
    byUrl.set(url, entry);
  }
  return [...byUrl.values()]
    .filter((e) => filter === "all" || (filter === "incognito" ? e.incognito : !e.incognito))
    .sort((a, b) => a.url.localeCompare(b.url));
}
