import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve("work/original-unpacked");
const output = [];

async function launch(folder) {
  const extensionPath = path.join(root, folder);
  const context = await chromium.launchPersistentContext(path.resolve(`work/original-profile-${folder}-${process.pid}`), {
    headless:false, args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run"]
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout:15000 });
  return { context, worker, id:new URL(worker.url()).host };
}

async function observeTabOrganizer() {
  const folder = "hjdhimdmbhgadalmpkkfnpjeppnkfabd"; const { context, worker, id } = await launch(folder);
  const a = await context.newPage(); await a.goto("https://example.com/?original=1");
  const b = await context.newPage(); await b.goto("https://www.iana.org/domains/reserved");
  const c = await context.newPage(); await c.goto("https://example.com/?original=2");
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/src/ui/side-panel/index.html`);
  await ui.screenshot({ path:"work/original-tab-organizer.png", fullPage:true });
  const buttons = await ui.getByRole("button").allTextContents();
  const group = ui.getByRole("button", { name:"Group", exact:true });
  let outcome = "blocked";
  if (await group.isEnabled()) {
    await group.click(); await ui.waitForTimeout(1000);
    const groups = await worker.evaluate(() => chrome.tabGroups.query({}));
    outcome = groups.length ? `created ${groups.length} group(s): ${groups.map((g) => g.title).join(", ")}` : "button clicked but no groups appeared";
  }
  output.push({ extension:"Tab Organizer: Productivity Tool", version:"0.0.51", browserUI:true, buttons, outcome });
  await context.close();
}

async function observeSessionBuddy() {
  const folder = "edacconmaakjimmfgnblocblbcdcpbko"; const { context, id } = await launch(folder);
  const a = await context.newPage(); await a.goto("https://example.com/?session=1");
  const b = await context.newPage(); await b.goto("https://www.iana.org/domains/reserved?session=2");
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/session-buddy.html`); await ui.waitForTimeout(1500);
  const closeWelcome = ui.getByRole("button", { name:"Close" }); if (await closeWelcome.isVisible()) { await closeWelcome.click(); await ui.waitForTimeout(300); }
  await ui.screenshot({ path:"work/original-session-buddy.png", fullPage:true });
  const beforeText = (await ui.locator("body").innerText()).slice(0,2500);
  const save = ui.getByText("Save", { exact:true }).first();
  let saveOutcome = "Save control not available";
  if (await save.isVisible()) { await save.click(); await ui.waitForTimeout(800); saveOutcome = (await ui.locator("body").innerText()).slice(0,2500); }
  const buttons = await ui.getByRole("button").allTextContents();
  output.push({ extension:"Session Buddy", version:"4.1.2", browserUI:true, buttons, observedText:beforeText, afterSaveInteraction:saveOutcome });
  await context.close();
}

async function observeWindowMerger() {
  const folder = "fijodggmkbkjcmlpkpahjpepngppdppb"; const { context, worker } = await launch(folder);
  const first = context.pages()[0] || await context.newPage(); await first.goto("https://example.com/?target=1");
  await worker.evaluate(() => chrome.windows.create({ url:["https://www.iana.org/domains/reserved?source=1", "https://example.com/?source=2"] }));
  const before = await worker.evaluate(() => chrome.windows.getAll({ populate:true, windowTypes:["normal"] }));
  await first.bringToFront(); await first.keyboard.press("Alt+Shift+M"); await first.waitForTimeout(1500);
  const after = await worker.evaluate(() => chrome.windows.getAll({ populate:true, windowTypes:["normal"] }));
  output.push({ extension:"Window Merger", version:"1.5.0", browserUI:true, beforeWindows:before.length, afterWindows:after.length, afterTabs:after.reduce((n,w) => n+(w.tabs?.length||0),0), outcome:after.length < before.length ? "keyboard shortcut merged windows" : "shortcut did not merge under automation" });
  await context.close();
}

for (const fn of [observeTabOrganizer, observeSessionBuddy, observeWindowMerger]) {
  try { await fn(); } catch (error) { output.push({ extension:fn.name, browserUI:false, error:error.message }); }
}
fs.writeFileSync("work/original-observations.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
