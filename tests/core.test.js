import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, groupLabel, groupTitle, chooseDuplicateKeeper } from "../extension/core.js";
import { sessionsToCsv, sessionsToJson } from "../extension/export.js";
import fs from "node:fs";

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
test("session JSON and CSV exports preserve tabs and escape CSV", () => {
  const sessions = [{ id:"s1", name:'Work, "Today"', createdAt:0, windows:[{ tabs:[{ title:"One", url:"https://example.com/a,b", pinned:true, muted:false, group:"example.com" }] }] }];
  assert.equal(JSON.parse(sessionsToJson(sessions, "2026-10-28T00:00:00.000Z")).sessions[0].windows[0].tabs[0].url, "https://example.com/a,b");
  const csv = sessionsToCsv(sessions);
  assert.match(csv, /"Work, ""Today"""/); assert.match(csv, /"https:\/\/example.com\/a,b"/);
});
test("the composite organize shortcut is declared for macOS and other platforms", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../extension/manifest.json", import.meta.url)));
  assert.deepEqual(Object.keys(manifest.commands), ["organize-tabs"]);
  assert.equal(manifest.commands["organize-tabs"].suggested_key.default, "Ctrl+Shift+X");
  assert.equal(manifest.commands["organize-tabs"].suggested_key.mac, "Command+Shift+X");
});
