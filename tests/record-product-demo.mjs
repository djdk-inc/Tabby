import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const extensionPath = path.resolve("extension");
const videoDir = path.resolve("work/demo-video");
fs.mkdirSync(videoDir, { recursive:true });

const server = http.createServer((req, res) => {
  const isB = req.url?.startsWith("/b");
  res.writeHead(200, { "content-type":"text/html" });
  res.end(`<!doctype html><title>${isB ? "Research Notes" : "Project Brief"}</title><style>body{font:24px system-ui;padding:60px;background:#f5f7fb;color:#182033}main{max-width:760px;margin:auto;background:white;padding:48px;border-radius:20px;box-shadow:0 20px 60px #cad1df}small{color:#68758b}</style><main><small>Tabby demo page</small><h1>${isB ? "Research Notes" : "Project Brief"}</h1><p>This real browser tab is used to demonstrate organization, saving, deduplication, and session restore.</p></main>`);
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(path.resolve(`work/demo-profile-${process.pid}`), {
  headless:false,
  viewport:{ width:1280, height:720 },
  recordVideo:{ dir:videoDir, size:{ width:1280, height:720 } },
  args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"]
});
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker");
const extensionId = new URL(worker.url()).host;

const control = await context.newPage();
await control.goto(`chrome-extension://${extensionId}/dashboard.html`);
await control.evaluate(() => chrome.storage.local.set({
  settings:{ autoOrganize:false, groupingMode:"domain", collapseInactive:true, inactiveMinutes:30, dedupeOnNavigate:false, protectPinned:true, protectAudible:true, stripTracking:true },
  library:[], sessions:[]
}));

const seed1 = await context.newPage(); await seed1.goto(`${origin}/a`);
const seed2 = await context.newPage(); await seed2.goto("https://example.com/?demo=one");
const seed3 = await context.newPage(); await seed3.goto("https://www.iana.org/domains/reserved");
const seed4 = await context.newPage(); await seed4.goto("https://example.com/?demo=one&utm_source=video#copy");
await worker.evaluate((url) => chrome.windows.create({ url }), `${origin}/b`);

const demo = control;
const hold = (ms = 1500) => demo.waitForTimeout(ms);
async function caption(text) {
  await demo.evaluate((text) => {
    document.querySelector("#demo-caption")?.remove();
    const el = document.createElement("div"); el.id = "demo-caption"; el.textContent = text;
    Object.assign(el.style, { position:"fixed", right:"22px", top:"18px", zIndex:"99999", background:"#7aa2ff", color:"#07101f", padding:"10px 16px", borderRadius:"999px", font:"700 14px system-ui", boxShadow:"0 8px 30px #0007" });
    document.body.appendChild(el);
  }, text);
}

await demo.bringToFront();
await caption("Tabby — real extension, isolated browser profile"); await hold(2200);

await demo.goto(`chrome-extension://${extensionId}/popup.html`);
await caption("1 · Organize existing tabs into native domain groups"); await hold(1200);
await demo.getByRole("button", { name:"Organize now" }).click(); await hold(2200);

await caption("2 · Remove canonical duplicate URLs");
await demo.getByRole("button", { name:"Remove duplicates" }).click(); await hold(2200);

await demo.goto(`chrome-extension://${extensionId}/dashboard.html`);
await caption("3 · Save open tabs to the local library"); await hold(1000);
await demo.getByRole("button", { name:"Save current window" }).click(); await hold(2500);

await demo.getByRole("button", { name:"Sessions" }).click();
await caption("4 · Save a restorable multi-window session"); await hold(1000);
await demo.getByRole("button", { name:"Save current session" }).click(); await hold(2500);

await demo.getByRole("button", { name:"Settings" }).click();
await caption("5 · Configure automation and protection rules"); await hold(1200);
await demo.locator('[data-setting="groupingMode"]').selectOption("subdomain"); await hold(900);
await demo.locator('[data-setting="autoOrganize"]').check(); await hold(1800);

await demo.goto(`chrome-extension://${extensionId}/popup.html`);
await caption("6 · Consolidate browser windows while preserving pinned tabs"); await hold(1200);
await demo.getByRole("button", { name:"Merge windows" }).click(); await hold(2500);

await demo.goto(`chrome-extension://${extensionId}/dashboard.html`);
await demo.getByRole("button", { name:"Sessions" }).click();
await caption("Done · Tabs organized, deduplicated, saved, and consolidated"); await hold(3200);

const video = demo.video();
await context.close();
await new Promise((resolve) => server.close(resolve));
console.log(await video.path());
