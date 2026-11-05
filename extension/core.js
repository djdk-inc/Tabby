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
  focusLimitEnabled: false,
  focusStart: "09:00",
  focusEnd: "17:00",
  focusDays: [1, 2, 3, 4, 5],
  focusDomains: ["youtube.com", "reddit.com", "x.com", "instagram.com", "tiktok.com"]
};

export const FOCUS_TAB_LIMIT = 3;

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
