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
    if (fn === "removeTabs") return chrome.tabs.remove(arg);
    if (fn === "storage") return chrome.storage.local.get(arg);
    if (fn === "setStorage") return chrome.storage.local.set(arg);
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
    // New headless mode (channel "chromium") loads MV3 extensions without opening windows; TABBY_HEADED=1 to watch.
    channel: "chromium", headless: process.env.TABBY_HEADED !== "1",
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
  await expect(page.locator("button")).toHaveText(["Organize", "Sessions", "Settings"]);
  await expect(page.getByText("A calmer browser")).toHaveCount(0);
  await expect(page.locator("#focusStatus")).toHaveText("Focus hours are active: up to 3 tabs per limited domain across all windows.");
  const opened = context.waitForEvent("page"); await page.getByRole("button", { name:"Settings" }).click();
  const settingsPage = await opened; await expect(settingsPage.locator("#settings")).toBeVisible(); await settingsPage.close();
  await expect.poll(() => page.isClosed()).toBe(true); // popup closes itself after opening a page
  const dash = await context.newPage(); await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(dash.locator("[data-tab]")).toHaveText(["Sessions", "Settings"]);
  await expect(dash.locator("#sessions")).toBeVisible();
  await dash.screenshot({ path:"work/dashboard.png", fullPage:true });
  await dash.close();
});

test("groups existing and newly opened tabs by domain and sorts group titles", async () => {
  const p1 = await context.newPage(); await p1.goto(`${origin}/a`);
  const p2 = await context.newPage(); await p2.goto("https://example.com/?e2e=1");
  const p3 = await context.newPage(); await p3.goto("https://www.iana.org/domains/reserved");
  const tabs = await api("tabs", {}); const target = tabs.find((t) => t.url === `${origin}/a`).windowId;
  const iconTab = await api("createTab", { windowId:target, url:"https://x.com/?tabby-icon-test=1", active:false });
  await expect.poll(async () => (await api("tabs", { windowId:target })).find((tab) => tab.id === iconTab.id)?.url).toContain("x.com/");
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
  test.skip(process.env.TABBY_HEADED !== "1", "Headless Chromium has no audio output, so tabs never report audible; run with TABBY_HEADED=1.");
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

test("Chrome assigns the organize and save-session keyboard shortcuts", async () => {
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const commands = await page.evaluate(() => chrome.commands.getAll());
  const keys = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
  const mac = process.platform === "darwin";
  expect(keys["save-session"]).toBe(mac ? "⇧⌘S" : "Ctrl+Shift+S");
  expect(keys["organize-tabs"]).toBe(mac ? "⇧⌘X" : "Ctrl+Shift+X");
  await page.close();
});

test("saves and restores sessions", async () => {
  const seed = await context.newPage(); await seed.goto(`${origin}/a?session=1`);
  await rpc("save-session", { name:"E2E Session" });
  const stored = await api("storage", ["sessions"]); expect(stored.sessions[0].name).toBe("E2E Session");
  const before = (await api("windows")).length; const restored = await rpc("restore-session", { id:stored.sessions[0].id }); expect(restored.windows).toBeGreaterThan(0);
  expect((await api("windows")).length).toBeGreaterThan(before);
});

test("sessions list nests windows and URLs and restores one window in its saved mode", async () => {
  const session = { id:"nested-1", name:"Nested", createdAt:Date.now(), windows:[
    { incognito:false, tabs:[{ url:`${origin}/a?nested=1`, title:"Nested A" }, { url:`${origin}/b?nested=2`, title:"Nested B" }] },
    { incognito:true, tabs:[{ url:`${origin}/a?nested=3`, title:"Secret" }] }
  ] };
  await api("setStorage", { sessions:[session] });
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/dashboard.html`); await page.getByRole("button", { name:"Sessions" }).click();
  const card = page.locator("details.session").first();
  await expect(card.locator("summary").first()).toContainText("2 windows · 3 tabs");
  await expect(card.getByText(`${origin}/a?nested=1`)).toBeHidden();
  await card.locator("summary").first().click();
  const win1 = card.locator("details.window").nth(0), win2 = card.locator("details.window").nth(1);
  await expect(win2).toContainText("Incognito");
  await win1.locator("summary").click(); await expect(win1.getByText(`${origin}/a?nested=1`)).toBeVisible(); await expect(win1.getByText(`${origin}/b?nested=2`)).toBeVisible(); await expect(win1.getByText("Nested A")).toHaveCount(0);
  const before = (await api("windows")).length;
  await win1.getByRole("button", { name:"Open" }).click();
  await expect.poll(async () => (await api("windows")).length).toBe(before + 1);
  await expect(win1.getByText(`${origin}/a?nested=1`)).toBeVisible(); // expansion survives re-render
  await win2.getByRole("button", { name:"Open" }).click();
  await expect(page.locator("#sessionStatus")).toContainText("Allow Tabby in Incognito");
  expect((await api("windows")).length).toBe(before + 1);
  await page.close();
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

test("organize survives arbitrary tab-strip layouts and concurrent tab changes", async () => {
  const port = new URL(origin).port;
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const errors = await page.evaluate(async (port) => {
    const hosts = ["127.0.0.1", "localhost", "a.localhost", "b.localhost", "c.localhost"];
    let seed = 7; const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const send = (msg) => chrome.runtime.sendMessage(msg);
    const errors = [];
    for (let round = 0; round < 30; round++) {
      const count = 4 + rand(8);
      const urls = Array.from({ length: count }, (_, i) => rand(5) === 0 ? "about:blank" : `http://${hosts[rand(hosts.length)]}:${port}/a?r=${round}&i=${i}`);
      const win = await chrome.windows.create({ url: urls, focused: false });
      const tabs = await chrome.tabs.query({ windowId: win.id });
      for (const tab of tabs) if (rand(6) === 0) await chrome.tabs.update(tab.id, { pinned: true });
      const loose = (await chrome.tabs.query({ windowId: win.id, pinned: false })).map((t) => t.id);
      for (let g = 0; g < 2 && loose.length > 1; g++) {
        const pick = loose.splice(rand(loose.length), 1 + rand(2));
        const gid = await chrome.tabs.group({ tabIds: pick, createProperties: { windowId: win.id } });
        await chrome.tabGroups.update(gid, { title: ["Work", "zzz", "Alpha"][rand(3)] });
      }
      const concurrent = round % 2 === 1;
      const runs = [send({ type: "organize", windowId: win.id })];
      if (concurrent) {
        const victims = (await chrome.tabs.query({ windowId: win.id, pinned: false })).slice(0, 2).map((t) => t.id);
        runs.push(new Promise((r) => setTimeout(r, rand(20))).then(() => chrome.tabs.remove(victims)).then(() => ({ ok: true })));
        runs.push(send({ type: "organize", windowId: win.id }));
      }
      for (const r of await Promise.all(runs)) if (!r.ok) errors.push(`round ${round}: ${r.error}`);
      await chrome.windows.remove(win.id).catch(() => {});
    }
    return errors;
  }, port);
  await page.close();
  expect(errors).toEqual([]);
});

test("unexpected errors are written to tabby_errors.json; user-facing ones are not", async () => {
  const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const result = await page.evaluate(async () => {
    const created = new Promise((resolve) => chrome.downloads.onCreated.addListener(function on(item) {
      if (!item.url.startsWith("data:application/json")) return;
      chrome.downloads.onCreated.removeListener(on); resolve(item);
    }));
    await chrome.runtime.sendMessage({ type: "restore-session", id: "missing" }); // user-facing: not logged
    await chrome.runtime.sendMessage({ type: "no-such-action" });
    await chrome.runtime.sendMessage({ type: "no-such-action" });
    const item = await created;
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(item.url.split(",")[1]), (c) => c.charCodeAt(0))));
    await new Promise((r) => setTimeout(r, 1500));
    return { json, erased: (await chrome.downloads.search({ id: item.id })).length === 0 };
  });
  await page.close();
  const unknown = result.json.errors.find((e) => e.message === "Unknown action: no-such-action");
  expect(unknown).toMatchObject({ source: "action:no-such-action", count: 2 });
  expect(result.json.errors.some((e) => e.message === "Session not found")).toBe(false);
  expect(result.json.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(result.erased).toBe(true);
  const stored = await api("storage", "errorLog"); expect(stored.errorLog.some((e) => e.message === "Unknown action: no-such-action")).toBe(true);
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

test("focus schedule boundaries execute in the real extension browser context", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const results = await page.evaluate(async () => {
    const { isFocusScheduleActive } = await import(chrome.runtime.getURL("core.js"));
    return [
      isFocusScheduleActive(new Date(2026, 9, 26, 8, 59), "09:00", "17:00", [1]),
      isFocusScheduleActive(new Date(2026, 9, 26, 9, 0), "09:00", "17:00", [1]),
      isFocusScheduleActive(new Date(2026, 9, 26, 17, 0), "09:00", "17:00", [1]),
      isFocusScheduleActive(new Date(2026, 9, 26, 22, 0), "22:00", "06:00", [1]),
      isFocusScheduleActive(new Date(2026, 9, 27, 5, 59), "22:00", "06:00", [1]),
      isFocusScheduleActive(new Date(2026, 9, 27, 6, 0), "22:00", "06:00", [1])
    ];
  });
  expect(results).toEqual([false, true, false, true, true, false]);
  await page.close();
});

test("fourth domain tab is safely gated across windows with explicit and protected exceptions", async () => {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const priorTabs = await control.evaluate(() => chrome.tabs.query({}));
  const localIds = priorTabs.filter((tab) => tab.url?.startsWith(origin)).map((tab) => tab.id);
  if (localIds.length) await control.evaluate((ids) => chrome.tabs.remove(ids), localIds);
  await control.evaluate(async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings:{ ...settings, focusLimitEnabled:true, focusStart:"00:00", focusEnd:"00:00", focusDays:[0,1,2,3,4,5,6], focusDomains:["127.0.0.1"], autoOrganize:false, dedupeOnNavigate:false, protectPinned:true, protectAudible:true } });
  });

  const first = await api("createTab", { url:`${origin}/a?focus=1`, active:false });
  const second = await api("createTab", { windowId:first.windowId, url:`${origin}/a?focus=2`, active:false });
  const otherWindow = await api("createWindow", { url:`${origin}/a?focus=3`, focused:false });
  const windowIds = new Set([first.windowId, otherWindow.id]);
  expect(windowIds.size).toBe(2);

  const fourth = await api("createTab", { windowId:first.windowId, url:`${origin}/a?focus=4`, active:false });
  await expect.poll(async () => (await api("tabs", {})).find((tab) => tab.id === fourth.id)?.url).toContain("focus-limit.html");
  const decision = context.pages().find((page) => page.url().includes("focus-limit.html"));
  expect(decision).toBeTruthy();
  await expect(decision.getByRole("heading", { name:"Three tabs is enough for now" })).toBeVisible();
  await expect(decision.getByText(`${origin}/a?focus=4`, { exact:true })).toBeVisible();
  await expect(decision.locator("#existingTabs button")).toHaveCount(3);

  await decision.getByRole("button", { name:"Open anyway in this tab" }).click();
  await expect.poll(async () => (await api("tabs", {})).find((tab) => tab.id === fourth.id)?.url).toBe(`${origin}/a?focus=4`);

  const fifth = await api("createTab", { windowId:first.windowId, url:`${origin}/a?focus=5`, active:false });
  await expect.poll(async () => (await api("tabs", {})).find((tab) => tab.id === fifth.id)?.url).toContain("focus-limit.html");
  const decision5 = context.pages().find((page) => page.url().includes("focus-limit.html"));
  await decision5.getByRole("button", { name:"Save for later" }).click();
  await expect(decision5.getByText("Saved to Sessions.")).toBeVisible();
  const saved = (await api("storage", "sessions")).sessions[0];
  expect(saved.name).toBe("Saved for later: 127.0.0.1"); expect(saved.windows[0].tabs[0].url).toBe(`${origin}/a?focus=5`);
  await api("removeTabs", fifth.id);

  const pinned = await api("createTab", { windowId:first.windowId, url:"about:blank", active:false, pinned:true });
  await api("updateTab", { id:pinned.id, props:{ url:`${origin}/b?focus=pinned` } });
  await expect.poll(async () => (await api("tabs", {})).find((tab) => tab.id === pinned.id)?.url).toBe(`${origin}/b?focus=pinned`);

  await control.evaluate(async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings:{ ...settings, focusDays:[] } });
  });
  const outside = await api("createTab", { windowId:first.windowId, url:`${origin}/b?focus=outside`, active:false });
  await expect.poll(async () => (await api("tabs", {})).find((tab) => tab.id === outside.id)?.url).toBe(`${origin}/b?focus=outside`);
  await control.close();
});

test("focus settings persist through the dashboard controls", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await page.getByRole("button", { name:"Settings" }).click();
  await page.locator('[data-setting="focusLimitEnabled"]').check();
  await page.locator('[data-setting="focusStart"]').fill("08:30");
  await page.locator('[data-setting="focusStart"]').dispatchEvent("change");
  await page.locator('[data-setting="focusDomains"]').fill("www.reddit.com\nyoutube.com");
  await page.locator('[data-setting="focusDomains"]').dispatchEvent("change");
  const stored = await page.evaluate(() => chrome.storage.local.get("settings"));
  expect(stored.settings.focusLimitEnabled).toBe(true);
  expect(stored.settings.focusStart).toBe("08:30");
  expect(stored.settings.focusDomains).toEqual(["reddit.com", "youtube.com"]);
  await page.close();
});

test("updating over an enabled 9-5 weekday schedule makes it all day, and a 4th tab is redirected", async () => {
  // Mirrors a real update: old version installed with saved settings, folder replaced, Chrome restarted.
  const work = fs.mkdtempSync(path.resolve("work/upgrade-"));
  const extDir = path.join(work, "ext"); fs.cpSync(extensionPath, extDir, { recursive: true });
  const manifestPath = path.join(extDir, "manifest.json"); const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const launch = () => chromium.launchPersistentContext(path.join(work, "profile"), {
    channel: "chromium", headless: process.env.TABBY_HEADED !== "1",
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-first-run", "--no-default-browser-check"]
  });
  const idOf = async (ctx) => new URL((ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker")).url()).host;
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "2.0.0" }));
  let ctx = await launch(); let id = await idOf(ctx);
  let page = await ctx.newPage(); await page.goto(`chrome-extension://${id}/dashboard.html`);
  // Storage as a pre-2.1.1 install leaves it: user's settings saved, no migration marker.
  await page.evaluate(async (o) => {
    await chrome.storage.local.remove("migrations");
    await chrome.storage.local.set({ settings: { focusLimitEnabled: true, focusStart: "09:00", focusEnd: "17:00", focusDays: [1, 2, 3, 4, 5], focusDomains: [o], dedupeOnNavigate: false } });
  }, new URL(origin).hostname);
  await ctx.close();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  ctx = await launch(); id = await idOf(ctx);
  page = await ctx.newPage(); await page.goto(`chrome-extension://${id}/dashboard.html`);
  await expect.poll(async () => { const { settings } = await page.evaluate(() => chrome.storage.local.get("settings")); return [settings.focusLimitEnabled, settings.focusStart, settings.focusEnd, settings.focusDays.length]; }, { timeout: 10000 })
    .toEqual([true, "00:00", "00:00", 7]);
  for (let i = 1; i <= 4; i++) { const t = await ctx.newPage(); await t.goto(`${origin}/a?upgrade=${i}`).catch(() => {}); }
  await expect.poll(async () => (await page.evaluate(() => chrome.tabs.query({}))).filter((t) => t.url.includes("focus-limit.html")).length).toBe(1);
  const popup = await ctx.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator("#focusStatus")).toContainText("Focus hours are active");
  await ctx.close(); fs.rmSync(work, { recursive: true, force: true });
});
