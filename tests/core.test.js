import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl, groupLabel, groupTitle, chooseDuplicateKeeper, isFocusScheduleActive,
  addToErrorLog, groupsInOrder, mergePlan, savedUrls, upgradeFocusDefaults, normalizeFocusDomains, restrictedDomainForUrl
} from "../extension/core.js";
import { sessionsToCsv } from "../extension/export.js";

test("domain and subdomain labels", () => {
  assert.equal(groupLabel("https://mail.google.com/a", "domain"), "google.com");
  assert.equal(groupLabel("https://mail.google.com/a", "subdomain"), "mail.google.com");
  assert.equal(groupLabel("https://news.bbc.co.uk/a", "domain"), "bbc.co.uk");
});
test("recognized domains use compact group symbols with a domain fallback", () => {
  assert.equal(groupTitle("https://x.com/openai", "domain", true), "𝕏");
  assert.equal(groupTitle("https://www.youtube.com/watch?v=1", "domain", true), "▶");
  assert.equal(groupTitle("https://example.com/a", "domain", true), "example.com");
  assert.equal(groupTitle("https://x.com/openai", "domain", false), "x.com");
});
test("canonical URL removes fragments, tracking and trailing slash", () => {
  assert.equal(canonicalUrl("https://www.Example.com/a/?utm_source=x&b=2#top"), "https://example.com/a?b=2");
});
test("duplicate keeper prioritizes protected then active", () => {
  assert.equal(chooseDuplicateKeeper([{ id:1, active:true }, { id:2, pinned:true }], { protectPinned:true, protectAudible:true }).id, 2);
  assert.equal(chooseDuplicateKeeper([{ id:1, active:true }, { id:2 }], { protectPinned:true, protectAudible:true }).id, 1);
});
test("session CSV export escapes commas and quotes", () => {
  const sessions = [{ id:"s1", name:'Work, "Today"', createdAt:0, windows:[{ tabs:[{ title:"One", url:"https://example.com/a,b", pinned:true, muted:false, group:"example.com" }] }] }];
  const csv = sessionsToCsv(sessions);
  assert.match(csv, /"Work, ""Today"""/); assert.match(csv, /"https:\/\/example.com\/a,b"/);
});
test("focus schedule includes its start, excludes its end, and honors selected days", () => {
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 26, 8, 59), "09:00", "17:00", [1]), false);
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 26, 9, 0), "09:00", "17:00", [1]), true);
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 26, 16, 59), "09:00", "17:00", [1]), true);
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 26, 17, 0), "09:00", "17:00", [1]), false);
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 27, 10, 0), "09:00", "17:00", [1]), false);
});
test("overnight focus hours attribute the after-midnight segment to the starting day", () => {
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 26, 22, 0), "22:00", "06:00", [1]), true);
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 27, 5, 59), "22:00", "06:00", [1]), true);
  assert.equal(isFocusScheduleActive(new Date(2026, 9, 27, 6, 0), "22:00", "06:00", [1]), false);
});
test("focus domains normalize safely and include subdomains", () => {
  assert.deepEqual(normalizeFocusDomains("www.Reddit.com\nhttps://youtube.com/watch\nreddit.com"), ["reddit.com", "youtube.com"]);
  assert.equal(restrictedDomainForUrl("https://old.reddit.com/r/test", ["reddit.com"]), "reddit.com");
  assert.equal(restrictedDomainForUrl("https://notreddit.com/", ["reddit.com"]), null);
});

test("merge plan merges like with like: regular into regular, incognito into incognito", () => {
  const windows = [{ id: 1, incognito: false }, { id: 2, incognito: false }, { id: 3, incognito: true }, { id: 4, incognito: true }, { id: 5 }];
  const ids = (plan) => plan.map((p) => [p.targetId, p.sources.map((w) => w.id)]);
  assert.deepEqual(ids(mergePlan(windows, windows[1])), [[2, [1, 5]], [3, [4]]]);
  assert.deepEqual(ids(mergePlan(windows, windows[3])), [[4, [3]], [1, [2, 5]]]);
  assert.deepEqual(ids(mergePlan([{ id: 1 }, { id: 2, incognito: true }], { id: 1 })), []);
});

test("error log merges repeats into one counted entry, newest first, capped", () => {
  let log = [];
  log = addToErrorLog(log, { message: "A", source: "bg", version: "1" }, "t1");
  log = addToErrorLog(log, { message: "B", source: "bg", version: "1" }, "t2");
  log = addToErrorLog(log, { message: "A", source: "bg", version: "2" }, "t3");
  assert.deepEqual(log.map((e) => [e.message, e.count, e.firstSeen, e.lastSeen, e.version]), [["A", 2, "t1", "t3", "2"], ["B", 1, "t2", "t2", "1"]]);
  assert.equal(addToErrorLog(log, { message: "A", source: "page", version: "2" }, "t4").length, 3);
  assert.deepEqual(addToErrorLog(log, { message: "C", source: "bg" }, "t5", 2).map((e) => e.message), ["C", "A"]);
});

test("groups are in order only when alphabetical, contiguous, and before ungrouped tabs", () => {
  const title = (id) => ({ 1: "a", 2: "b" })[id];
  const strip = (...ids) => ids.map((g) => (g === "p" ? { pinned: true, groupId: -1 } : { groupId: g }));
  assert.equal(groupsInOrder(strip("p", 1, 1, 2, -1), title), true);
  assert.equal(groupsInOrder(strip(2, 1, -1), title), false);
  assert.equal(groupsInOrder(strip(1, -1, 2), title), false);
  assert.equal(groupsInOrder(strip(1, 2, 1), title), false);
});

test("old default 9-5 weekday schedule moves to on/all-day/every-day; customized ones are kept", () => {
  const old = { focusLimitEnabled: false, focusStart: "09:00", focusEnd: "17:00", focusDays: [1, 2, 3, 4, 5], groupingMode: "subdomain" };
  assert.deepEqual(upgradeFocusDefaults(old), { ...old, focusLimitEnabled: true, focusStart: "00:00", focusEnd: "00:00", focusDays: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual(upgradeFocusDefaults({ ...old, focusLimitEnabled: true }), { ...old, focusLimitEnabled: true, focusStart: "00:00", focusEnd: "00:00", focusDays: [0, 1, 2, 3, 4, 5, 6] });
  const custom = { ...old, focusEnd: "18:00" };
  assert.equal(upgradeFocusDefaults(custom), custom);
  assert.equal(upgradeFocusDefaults(undefined), undefined);
});

test("saved URLs are deduplicated, sorted, and split by incognito: Regular never includes an incognito URL", () => {
  const sessions = [
    { windows: [{ incognito: true, tabs: [{ url: "https://b.com/x?utm_source=1#top" }, { url: "https://a.com/" }] }] },
    { windows: [{ tabs: [{ url: "https://b.com/x" }, { url: "https://c.com/" }, { url: "chrome://settings" }] }] }
  ];
  const all = savedUrls(sessions);
  assert.deepEqual(all.map((e) => [e.url, e.incognito, e.regular]), [
    ["https://a.com/", true, false], ["https://b.com/x", true, true], ["https://c.com/", false, true]
  ]);
  assert.deepEqual(savedUrls(sessions, "incognito").map((e) => e.url), ["https://a.com/", "https://b.com/x"]);
  assert.deepEqual(savedUrls(sessions, "regular").map((e) => e.url), ["https://c.com/"]);
});
