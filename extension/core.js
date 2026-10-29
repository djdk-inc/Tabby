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
  stripTracking: true
};

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
