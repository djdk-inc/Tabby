import { chromium } from "@playwright/test";
import path from "node:path";

const extensionPath = path.resolve("extension");
const profilePath = path.resolve(`work/review-profile-${Date.now()}`);
const context = await chromium.launchPersistentContext(profilePath, {
  headless:false,
  noViewport:true,
  args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check", "--window-position=0,0", "--window-size=1728,1050"]
});

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker");
const extensionId = new URL(worker.url()).host;
const dashboard = await context.newPage();
await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
const mainWindowId = await dashboard.evaluate(async () => (await chrome.windows.getCurrent()).id);

await dashboard.evaluate(async () => {
  await chrome.storage.local.set({
    settings:{ autoOrganize:true, groupingMode:"domain", collapseOnLeave:true, collapseInactive:true, inactiveMinutes:30, dedupeOnNavigate:false, protectPinned:true, protectAudible:true, stripTracking:true },
    library:[], sessions:[]
  });
  await chrome.storage.session.clear();
});

const mainUrls = [
  "https://www.w3.org/",
  "https://example.com/?review=duplicate",
  "https://example.com/?review=duplicate&utm_source=second-copy#same-page",
  "https://www.iana.org/domains/reserved",
  "https://www.iana.org/help/example-domains",
  "https://developer.mozilla.org/en-US/docs/Web/API/Window",
  "https://developer.mozilla.org/en-US/docs/Web/API/Document",
  "https://en.wikipedia.org/wiki/Tab_(interface)",
  "https://en.wikipedia.org/wiki/Web_browser",
  "https://docs.github.com/en/get-started",
  "https://www.npmjs.com/package/playwright"
];

const mainTabs = [];
for (const url of mainUrls) mainTabs.push(await dashboard.evaluate(([windowId, url]) => chrome.tabs.create({ windowId, url, active:false }), [mainWindowId, url]));
await dashboard.evaluate((id) => chrome.tabs.update(id, { pinned:true }), mainTabs[0].id);

const secondWindow = await dashboard.evaluate(() => chrome.windows.create({
  url:["https://example.com/?from=second-window", "https://web.dev/learn/", "https://developer.chrome.com/docs/extensions/"],
  left:640, top:130, width:1000, height:760, focused:true
}));

await dashboard.evaluate((windowId) => chrome.runtime.sendMessage({ type:"organize", windowId }), mainWindowId);
await dashboard.evaluate((windowId) => chrome.runtime.sendMessage({ type:"organize", windowId }), secondWindow.id);

const libraryIds = [mainTabs[1].id, mainTabs[2].id, mainTabs[3].id, mainTabs[5].id, mainTabs[7].id, mainTabs[9].id];
await dashboard.evaluate((tabIds) => chrome.runtime.sendMessage({ type:"save-tabs", tabIds }), libraryIds);
await dashboard.evaluate(() => chrome.runtime.sendMessage({ type:"save-session", name:"Review workspace — two windows" }));
await dashboard.evaluate((windowId) => chrome.windows.update(windowId, { focused:true }), mainWindowId);

await dashboard.reload();
await dashboard.bringToFront();
const reviewWindows = await dashboard.evaluate(() => chrome.windows.getAll({ populate:true, windowTypes:["normal"] }));
console.log(JSON.stringify({ ready:true, extensionId, profilePath, mainWindowId, secondWindowId:secondWindow.id, windows:reviewWindows.map((w) => ({ id:w.id, tabs:w.tabs?.length })) }));

await new Promise((resolve) => {
  const done = () => resolve();
  process.once("SIGINT", done); process.once("SIGTERM", done);
  context.on("close", done);
});
if (context.browser()) await context.close().catch(() => {});
