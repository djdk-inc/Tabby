import { chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const extensionPath = path.resolve("extension");
const profilePath = fs.mkdtempSync(path.resolve("work/manual-focus-profile-"));
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type":"text/html" });
  response.end("<!doctype html><title>Tabby focus exercise</title><h1>Tabby focus exercise</h1>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;

try {
  context = await chromium.launchPersistentContext(profilePath, {
    headless:false,
    args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"]
  });
  let workers = context.serviceWorkers();
  if (!workers.length) workers = [await context.waitForEvent("serviceworker")];
  const extensionId = new URL(workers[0].url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await control.evaluate(() => chrome.storage.local.set({ settings:{
    autoOrganize:false, groupingMode:"domain", useSiteIcons:true, collapseInactive:false, collapseOnLeave:false,
    inactiveMinutes:30, dedupeOnNavigate:false, protectPinned:true, protectAudible:true, stripTracking:true,
    focusLimitEnabled:true, focusStart:"00:00", focusEnd:"00:00", focusDays:[0,1,2,3,4,5,6], focusDomains:["127.0.0.1"]
  } }));
  const createTab = (props) => control.evaluate((value) => chrome.tabs.create(value), props);
  const tabs = () => control.evaluate(() => chrome.tabs.query({}));

  const first = await createTab({ url:`${origin}/one`, active:false });
  await createTab({ windowId:first.windowId, url:`${origin}/two`, active:false });
  const secondWindow = await control.evaluate((url) => chrome.windows.create({ url, focused:false }), `${origin}/three`);
  for (let attempt = 0; attempt < 50; attempt++) {
    const committed = (await tabs()).filter((tab) => tab.url?.startsWith(origin));
    if (committed.length === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if ((await tabs()).filter((tab) => tab.url?.startsWith(origin)).length !== 3) throw new Error("The three baseline tabs did not finish navigating.");
  const fourth = await createTab({ windowId:first.windowId, url:`${origin}/four`, active:false });
  let fourthState;
  for (let attempt = 0; attempt < 50; attempt++) {
    fourthState = (await tabs()).find((tab) => tab.id === fourth.id);
    if (fourthState?.url.includes("focus-limit.html")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!fourthState?.url.includes("focus-limit.html")) throw new Error("Fourth tab was not gated.");
  const decision = context.pages().find((page) => page.url().includes("focus-limit.html"));
  await decision.waitForSelector("#existingTabs button");
  const existingChoices = await decision.locator("#existingTabs button").count();
  await decision.screenshot({ path:path.resolve("outputs/tabby-focus-limit-1.1.1.png"), fullPage:true });
  await decision.getByRole("button", { name:"Open anyway in this tab" }).click();

  const pinned = await createTab({ windowId:first.windowId, url:"about:blank", active:false, pinned:true });
  await control.evaluate(([id, url]) => chrome.tabs.update(id, { url }), [pinned.id, `${origin}/pinned-exception`]);
  let pinnedState;
  for (let attempt = 0; attempt < 50; attempt++) {
    pinnedState = (await tabs()).find((tab) => tab.id === pinned.id);
    if (pinnedState?.pinned && pinnedState.url === `${origin}/pinned-exception`) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const boundaries = await control.evaluate(async () => {
    const { isFocusScheduleActive } = await import(chrome.runtime.getURL("core.js"));
    return {
      beforeStart:isFocusScheduleActive(new Date(2026, 9, 26, 8, 59), "09:00", "17:00", [1]),
      atStart:isFocusScheduleActive(new Date(2026, 9, 26, 9, 0), "09:00", "17:00", [1]),
      atEnd:isFocusScheduleActive(new Date(2026, 9, 26, 17, 0), "09:00", "17:00", [1]),
      overnight:isFocusScheduleActive(new Date(2026, 9, 27, 5, 59), "22:00", "06:00", [1])
    };
  });
  const results = {
    fourthTabGated:true,
    crossWindowCounted:new Set([first.windowId, secondWindow.id]).size === 2,
    existingChoices,
    explicitOpenAnyway:(await tabs()).some((tab) => tab.id === fourth.id && tab.url === `${origin}/four`),
    pinnedException:pinnedState?.pinned && pinnedState.url === `${origin}/pinned-exception`,
    boundaries
  };
  if (!results.crossWindowCounted || results.existingChoices !== 3 || !results.explicitOpenAnyway || !results.pinnedException ||
      results.boundaries.beforeStart || !results.boundaries.atStart || results.boundaries.atEnd || !results.boundaries.overnight) {
    throw new Error(`Manual focus exercise failed: ${JSON.stringify(results)}`);
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(profilePath, { recursive:true, force:true });
}
