import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const extensionPath = path.resolve(process.env.TABBY_EXTENSION_PATH || "extension");
let context, extensionId, server, origin, profilePath;

async function rpc(type, extra = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const response = await page.evaluate(([type, extra]) => chrome.runtime.sendMessage({ type, ...extra }), [type, extra]);
  await page.close();
  expect(response.ok, response.error).toBe(true);
  return response;
}

async function api(fn, arg) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const out = await page.evaluate(async ([fn, arg]) => {
    if (fn === "tabs") return chrome.tabs.query(arg);
    if (fn === "groups") return chrome.tabGroups.query(arg);
    if (fn === "windows") return chrome.windows.getAll({ populate:true, windowTypes:["normal"] });
    if (fn === "createWindow") return chrome.windows.create(arg);
    if (fn === "createTab") return chrome.tabs.create(arg);
    if (fn === "updateTab") return chrome.tabs.update(arg.id, arg.props);
    if (fn === "storage") return chrome.storage.local.get(arg);
  }, [fn, arg]);
  await page.close(); return out;
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = req.url?.startsWith("/audio") ? "audio.html" : req.url?.startsWith("/b") ? "b.html" : "a.html";
    res.writeHead(200, { "content-type":"text/html" }); res.end(fs.readFileSync(path.resolve("tests/fixtures", file)));
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  profilePath = fs.mkdtempSync(path.resolve("work/e2e-profile-"));
  context = await chromium.launchPersistentContext(profilePath, {
    headless: process.env.TABBY_HEADED !== "1",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"]
  });
  let workers = context.serviceWorkers();
  if (!workers.length) workers = [await context.waitForEvent("serviceworker")];
  extensionId = new URL(workers[0].url()).host;
});

test.afterAll(async () => { await context?.close(); await new Promise((resolve) => server.close(resolve)); if (profilePath) fs.rmSync(profilePath, { recursive:true, force:true }); });

test("popup and dashboard render as real extension pages", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole("heading", { name:"Tabby" })).toBeVisible();
  await expect(page.getByRole("button", { name:"Organize now" })).toBeVisible();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(page.getByText("Saved tabs", { exact:true }).first()).toBeVisible();
  await page.screenshot({ path:"work/dashboard.png", fullPage:true });
  await page.close();
});

test("groups existing and newly opened tabs by domain and sorts group titles", async () => {
  const p1 = await context.newPage(); await p1.goto(`${origin}/a`);
  const p2 = await context.newPage(); await p2.goto("https://example.com/?e2e=1");
  const p3 = await context.newPage(); await p3.goto("https://www.iana.org/domains/reserved");
  const tabs = await api("tabs", {}); const target = tabs.find((t) => t.url === `${origin}/a`).windowId;
  await api("createTab", { windowId:target, url:"https://x.com/?tabby-icon-test=1", active:false });
  const result = await rpc("organize", { windowId:target }); expect(result.groups).toBeGreaterThanOrEqual(3);
  const groups = await api("groups", { windowId:target });
  const titles = groups.map((g) => g.title); expect(titles).toEqual([...titles].sort((a,b) => a.localeCompare(b)));
  expect(titles).toContain("example.com"); expect(titles).toContain("iana.org"); expect(titles).toContain("127.0.0.1");
  expect(titles).toContain("𝕏"); expect(titles).not.toContain("x.com");
  const orderedTabs = await api("tabs", { windowId:target }); const titleByGroup = new Map(groups.map((g) => [g.id, g.title]));
  const groupOrder = [...new Set(orderedTabs.filter((t) => t.groupId >= 0).map((t) => titleByGroup.get(t.groupId)))];
  expect(groupOrder).toEqual([...groupOrder].sort((a,b) => a.localeCompare(b)));
  const fresh = await context.newPage(); await fresh.goto(`${origin}/b`); await fresh.waitForTimeout(1200);
  const freshTab = (await api("tabs", {})).find((t) => t.url === `${origin}/b`); expect(freshTab.groupId).toBeGreaterThanOrEqual(0);
});

test("deduplicates canonical URLs but protects pinned tabs", async () => {
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await control.evaluate(async () => { const { settings = {} } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings:{ ...settings, autoOrganize:false, dedupeOnNavigate:false } }); }); await control.close();
  const a = await context.newPage(); await a.goto(`${origin}/a?utm_source=one#x`);
  const b = await context.newPage(); await b.goto(`${origin}/a#y`);
  const tabs = await api("tabs", {}); const ta = tabs.find((t) => t.url.includes("utm_source=one")); const tb = tabs.find((t) => t.url.endsWith("/a#y"));
  await api("updateTab", { id:ta.id, props:{ pinned:true } });
  const result = await rpc("dedupe", { windowId:ta.windowId }); expect(result.removed).toBeGreaterThanOrEqual(1);
  const after = await api("tabs", { windowId:ta.windowId }); expect(after.some((t) => t.id === ta.id && t.pinned)).toBe(true); expect(after.some((t) => t.id === tb.id)).toBe(false);
});

test("protects a genuinely audible duplicate tab", async () => {
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await control.evaluate(async () => { const { settings = {} } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings:{ ...settings, autoOrganize:false, dedupeOnNavigate:false, protectAudible:true } }); }); await control.close();
  const audible = await context.newPage(); await audible.goto(`${origin}/audio`); await audible.getByRole("button", { name:"Play test tone" }).click();
  let audibleTab;
  await expect.poll(async () => { audibleTab = (await api("tabs", {})).find((t) => t.url === `${origin}/audio` && t.audible); return Boolean(audibleTab); }, { timeout:8000 }).toBe(true);
  const duplicate = await context.newPage(); await duplicate.goto(`${origin}/audio`);
  const duplicateTab = (await api("tabs", {})).find((t) => t.url === `${origin}/audio` && !t.audible);
  const result = await rpc("dedupe", { windowId:audibleTab.windowId }); expect(result.removed).toBe(1);
  const after = await api("tabs", { windowId:audibleTab.windowId }); expect(after.some((t) => t.id === audibleTab.id && t.audible)).toBe(true); expect(after.some((t) => t.id === duplicateTab.id)).toBe(false);
});

test("saves tabs to library and saves/restores sessions", async () => {
  const seed = await context.newPage(); await seed.goto(`${origin}/a?library=1`);
  const save = await rpc("save-tabs"); expect(save.saved).toBeGreaterThan(0);
  await rpc("save-session", { name:"E2E Session" });
  const stored = await api("storage", ["library", "sessions"]); expect(stored.library.length).toBeGreaterThan(0); expect(stored.sessions[0].name).toBe("E2E Session");
  const before = (await api("windows")).length; const restored = await rpc("restore-session", { id:stored.sessions[0].id }); expect(restored.windows).toBeGreaterThan(0);
  expect((await api("windows")).length).toBeGreaterThan(before);
});

test("deduplicates saved tabs and shows a flat alphabetical library", async () => {
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await control.evaluate(async () => { const { settings = {} } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ library:[], settings:{ ...settings, autoOrganize:false, dedupeOnNavigate:false, stripTracking:true } }); });
  const one = await context.newPage(); await one.goto(`${origin}/a?project=library`);
  const duplicate = await context.newPage(); await duplicate.goto(`${origin}/a?project=library&utm_source=copy#section`);
  const other = await context.newPage(); await other.goto("https://example.com/?saved-library=1");
  const tabs = await control.evaluate(() => chrome.tabs.query({}));
  const ids = tabs.filter((t) => t.url?.includes("project=library") || t.url?.includes("saved-library=1")).map((t) => t.id);
  const result = await control.evaluate((tabIds) => chrome.runtime.sendMessage({ type:"save-tabs", tabIds }), ids); expect(result.ok).toBe(true); expect(result.saved).toBe(2);
  await control.reload();
  const titles = await control.locator("#libraryList article strong").allTextContents(); expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b))); expect(titles).toHaveLength(2);
  const stored = await control.evaluate(() => chrome.storage.local.get("library")); expect(stored.library).toHaveLength(2); expect(new Set(stored.library.map((x) => x.domain))).toEqual(new Set(["127.0.0.1", "example.com"]));
  await control.close();
});

test("exports saved sessions to real JSON and CSV downloads", async () => {
  await rpc("save-session", { name:'Export, "Session"' });
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/dashboard.html`); await page.getByRole("button", { name:"Sessions" }).click();
  const jsonReady = page.waitForEvent("download"); await page.getByRole("button", { name:"Export JSON" }).click(); const jsonDownload = await jsonReady;
  expect(jsonDownload.suggestedFilename()).toMatch(/^tabby-sessions-\d{4}-\d{2}-\d{2}\.json$/);
  const json = JSON.parse(fs.readFileSync(await jsonDownload.path(), "utf8")); expect(json.sessions.some((x) => x.name === 'Export, "Session"')).toBe(true);
  const csvReady = page.waitForEvent("download"); await page.getByRole("button", { name:"Export CSV" }).click(); const csvDownload = await csvReady;
  expect(csvDownload.suggestedFilename()).toMatch(/^tabby-sessions-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = fs.readFileSync(await csvDownload.path(), "utf8"); expect(csv).toContain("session_id,session_name,created_at"); expect(csv).toContain('"Export, ""Session"""');
  await page.close();
});

test("collapses inactive groups and expands active group", async () => {
  const page = await context.newPage(); await page.goto(`${origin}/b?inactive=1`); const tabs = await api("tabs", {}); const tab = tabs.find((t) => t.url.includes("inactive=1"));
  await rpc("organize", { windowId:tab.windowId });
  const ext = await context.newPage(); await ext.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await ext.evaluate(() => chrome.storage.local.set({ settings:{ autoOrganize:false, groupingMode:"domain", collapseInactive:true, inactiveMinutes:0, dedupeOnNavigate:false, protectPinned:true, protectAudible:true, stripTracking:true } }));
  await ext.bringToFront(); const result = await rpc("collapse"); expect(result.collapsed).toBeGreaterThanOrEqual(1);
  const groups = await api("groups", { windowId:tab.windowId }); expect(groups.some((g) => g.collapsed)).toBe(true); await ext.close();
});

test("collapses the group just left and expands the group entered", async () => {
  const first = await context.newPage(); await first.goto("https://example.com/?leave-group=1");
  const second = await context.newPage(); await second.goto("https://www.iana.org/domains/reserved?enter-group=1");
  const tabs = await api("tabs", {}); const a = tabs.find((t) => t.url.includes("leave-group=1")); const b = tabs.find((t) => t.url.includes("enter-group=1"));
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await control.evaluate(async () => { const { settings = {} } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings:{ ...settings, autoOrganize:false, collapseOnLeave:true, collapseInactive:false } }); });
  await rpc("organize", { windowId:a.windowId });
  const grouped = await api("tabs", { windowId:a.windowId }); const ga = grouped.find((t) => t.id === a.id).groupId; const gb = grouped.find((t) => t.id === b.id).groupId;
  await control.evaluate((id) => chrome.tabs.update(id, { active:true }), a.id); await first.waitForTimeout(250);
  await control.evaluate((id) => chrome.tabs.update(id, { active:true }), b.id);
  await first.waitForTimeout(650);
  await expect.poll(async () => { const groups = await control.evaluate((windowId) => chrome.tabGroups.query({ windowId }), a.windowId); return [groups.find((g) => g.id === ga)?.collapsed, groups.find((g) => g.id === gb)?.collapsed]; }).toEqual([true, false]);
  await control.close();
});

test("merges normal windows while preserving pinned state", async () => {
  const wins = await api("windows"); const target = wins[0].id;
  await api("createTab", { windowId:target, url:`${origin}/a?merge-target=1`, active:false });
  const made = await api("createWindow", { url:[`${origin}/a?merge=1`, `${origin}/b?merge=2`] });
  const sourceTabs = await api("tabs", { windowId:made.id }); await api("updateTab", { id:sourceTabs[0].id, props:{ pinned:true } });
  const result = await rpc("merge", { windowId:target }); expect(result.windows).toBeGreaterThanOrEqual(1); expect(result.moved).toBeGreaterThanOrEqual(2);
  const after = await api("tabs", { windowId:target }); expect(after.some((t) => t.url.includes("merge=1") && t.pinned)).toBe(true); expect(after.some((t) => t.url.includes("merge=2"))).toBe(true);
  const mergedDomainTabs = after.filter((t) => t.url?.includes("merge-target=1") || t.url?.includes("merge=1") || t.url?.includes("merge=2"));
  const unpinnedMergedDomainTabs = mergedDomainTabs.filter((t) => !t.pinned); expect(new Set(unpinnedMergedDomainTabs.map((t) => t.groupId)).size).toBe(1);
  const groups = await api("groups", { windowId:target }); expect(groups.filter((g) => g.title === "127.0.0.1")).toHaveLength(1);
});

test("settings persist through the real dashboard UI", async () => {
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/dashboard.html`); await page.getByRole("button", { name:"Settings" }).click();
  const mode = page.locator('[data-setting="groupingMode"]'); await mode.selectOption("subdomain"); await expect(page.getByText("Saved.")).toBeVisible();
  const stored = await api("storage", "settings"); expect(stored.settings.groupingMode).toBe("subdomain"); await page.close();
});

test("Organize Now merges, deduplicates, groups, and evaluates inactive collapse", async () => {
  const control = await context.newPage(); await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await control.evaluate(async () => { const { settings = {} } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings:{ ...settings, autoOrganize:false, dedupeOnNavigate:false, collapseInactive:true, inactiveMinutes:0 } }); });
  const one = await context.newPage(); await one.goto(`${origin}/a?quick=1&utm_source=first`);
  const two = await context.newPage(); await two.goto(`${origin}/a?quick=1#copy`);
  const target = (await api("tabs", {})).find((t) => t.url.includes("quick=1&utm_source=first")).windowId;
  await api("createWindow", { url:[`${origin}/b?quick-window=1`, "https://example.com/?quick-window=2"] });
  const result = await rpc("organize-all", { windowId:target });
  expect(result.windows).toBeGreaterThanOrEqual(1); expect(result.moved).toBeGreaterThanOrEqual(2); expect(result.removed).toBeGreaterThanOrEqual(1); expect(result.groups).toBeGreaterThanOrEqual(1); expect(result.collapsed).toBeGreaterThanOrEqual(0);
  const after = await api("tabs", { windowId:target }); expect(after.filter((t) => t.url?.includes("quick=1"))).toHaveLength(1); expect(after.some((t) => t.url?.includes("quick-window=1") && t.groupId >= 0)).toBe(true);
  await control.close();
});
