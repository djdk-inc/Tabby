import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const extensionPath = path.resolve("extension");
const rawVideo = path.resolve("work/tab-strip-browser-demo-raw.mp4");
fs.mkdirSync(path.resolve("work"), { recursive:true });

const server = http.createServer((req, res) => {
  const second = req.url?.startsWith("/second");
  res.writeHead(200, { "content-type":"text/html" });
  res.end(`<!doctype html><title>${second ? "Second Window Tab" : "Protected Pinned Tab"}</title><style>body{margin:0;background:#0c111b;color:#eaf0ff;font:24px system-ui;display:grid;place-items:center;height:100vh}.card{width:min(760px,80%);padding:50px;border:1px solid #34435e;border-radius:24px;background:#141c2a;box-shadow:0 24px 80px #0008}small{color:#7aa2ff;font-weight:700}h1{font-size:44px;margin:12px 0}p{color:#aab6c9;line-height:1.5}</style><div class="card"><small>REAL BROWSER TAB</small><h1>${second ? "Second browser window" : "Pinned tab protection"}</h1><p>${second ? "This window and its tabs will be consolidated into the main window." : "This tab is pinned. Tabby will leave it open and outside automatic groups."}</p></div>`);
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(path.resolve(`work/tab-strip-profile-${process.pid}`), {
  headless:false,
  noViewport:true,
  args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check", "--window-position=0,0", "--window-size=1728,1117"]
});
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker");
const extensionId = new URL(worker.url()).host;

const dashboard = await context.newPage();
await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
await dashboard.evaluate(() => chrome.storage.local.set({ settings:{ autoOrganize:false, groupingMode:"domain", collapseOnLeave:true, collapseInactive:false, inactiveMinutes:30, dedupeOnNavigate:false, protectPinned:true, protectAudible:true, stripTracking:true }, library:[], sessions:[] }));
const mainWindowId = await dashboard.evaluate(async () => (await chrome.windows.getCurrent()).id);

const pinned = await context.newPage(); await pinned.goto(`${origin}/pinned`);
const pinnedId = await dashboard.evaluate(async (url) => (await chrome.tabs.query({ url })).at(-1)?.id, `${origin}/pinned`);
await dashboard.evaluate((id) => chrome.tabs.update(id, { pinned:true }), pinnedId);
const example1 = await context.newPage(); await example1.goto("https://example.com/?demo=1");
const iana = await context.newPage(); await iana.goto("https://www.iana.org/domains/reserved");
const mdn = await context.newPage(); await mdn.goto("https://developer.mozilla.org/en-US/");
const example2 = await context.newPage(); await example2.goto("https://example.com/?demo=1&utm_source=video#copy");
await dashboard.bringToFront();

async function banner(text, detail = "Watch the real Chrome tab strip above") {
  await dashboard.evaluate(([text, detail]) => {
    document.querySelector("#browser-demo-banner")?.remove();
    const el = document.createElement("div"); el.id = "browser-demo-banner";
    el.innerHTML = `<div style="font-size:13px;letter-spacing:.08em;color:#8bb0ff;font-weight:800">LIVE BROWSER RESULT</div><div style="font-size:28px;font-weight:800;margin:4px 0">${text}</div><div style="color:#aab6c9">${detail}</div>`;
    Object.assign(el.style,{position:"fixed",left:"50%",bottom:"28px",transform:"translateX(-50%)",width:"min(820px,80%)",zIndex:"99999",padding:"18px 24px",border:"1px solid #40547a",borderRadius:"16px",background:"#101827f2",boxShadow:"0 20px 70px #000b",textAlign:"center"});
    document.body.appendChild(el);
  }, [text, detail]);
}
const wait = (ms) => dashboard.waitForTimeout(ms);

await banner("Before: ordinary ungrouped tabs", "The first tab is pinned; two Example tabs are duplicates");
const startSignal = path.resolve("work/start-tab-strip-recording.signal");
try { fs.unlinkSync(startSignal); } catch {}
console.log(`READY:${startSignal}`);
while (!fs.existsSync(startSignal)) await new Promise((resolve) => setTimeout(resolve, 250));
fs.unlinkSync(startSignal);
await wait(1200);
const recorder = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "warning", "-f", "avfoundation", "-framerate", "25", "-capture_cursor", "1", "-i", "1:none", "-vf", "scale=1728:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", rawVideo], { stdio:["pipe", "ignore", "pipe"] });
await wait(2200);

await banner("Organizing tabs by domain…", "Native group chips will appear alphabetically in the tab strip");
await dashboard.evaluate((windowId) => chrome.runtime.sendMessage({ type:"organize", windowId }), mainWindowId);
await wait(4200);

await banner("Grouped: developer.mozilla.org · example.com · iana.org", "The pinned tab remains protected at the far left");
await wait(3800);

await banner("Removing a canonical duplicate…", "One of the two Example Domain tabs will disappear");
await dashboard.evaluate((windowId) => chrome.runtime.sendMessage({ type:"dedupe", windowId }), mainWindowId);
await wait(4000);

await banner("Duplicate removed", "The example.com group now contains one tab; the pinned tab remains");
await wait(3000);

const survivingExample = context.pages().find((page) => page.url().includes("example.com/?demo=1"));
await survivingExample.evaluate(() => { const el=document.createElement("div"); el.textContent="EXAMPLE.COM GROUP ACTIVE"; Object.assign(el.style,{position:"fixed",inset:"auto 10% 12%",zIndex:"99999",padding:"28px",background:"#101827ee",color:"#eaf0ff",border:"2px solid #7aa2ff",borderRadius:"18px",font:"800 34px system-ui",textAlign:"center"}); document.body.appendChild(el); });
await iana.evaluate(() => { const el=document.createElement("div"); el.textContent="IANA.ORG ACTIVE — EXAMPLE.COM COLLAPSED"; Object.assign(el.style,{position:"fixed",inset:"auto 10% 12%",zIndex:"99999",padding:"28px",background:"#101827ee",color:"#eaf0ff",border:"2px solid #7aa2ff",borderRadius:"18px",font:"800 34px system-ui",textAlign:"center"}); document.body.appendChild(el); });
const switchTabs = await dashboard.evaluate(() => chrome.tabs.query({ currentWindow:true }));
const exampleTabId = switchTabs.find((t) => t.url?.includes("example.com/?demo=1"))?.id;
const ianaTabId = switchTabs.find((t) => t.url?.includes("iana.org/domains/reserved"))?.id;
await banner("Collapse on leave / expand on enter", "Watch the native group chips while the active tab moves between groups"); await wait(2200);
await dashboard.evaluate((id) => chrome.tabs.update(id, { active:true }), exampleTabId); await wait(3000);
await dashboard.evaluate((id) => chrome.tabs.update(id, { active:true }), ianaTabId); await wait(3800);
await dashboard.bringToFront();
await banner("Collapse-on-leave verified", "The previous group collapsed immediately; the entered group expanded"); await wait(3200);

await dashboard.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings:{ ...settings, autoOrganize:true } }); });
await banner("Opening a new IANA tab with auto-organize enabled…", "It will join the existing iana.org group automatically");
await dashboard.evaluate(() => chrome.tabs.create({ url:"https://www.iana.org/help/example-domains", active:false }));
await wait(4500);

await banner("New tab joined the existing iana.org group", "This is the live tabs.onUpdated automation path");
await wait(3200);

await banner("Creating a second Chrome window…", "Next, Tabby will consolidate it into this main window");
await wait(1800);
const secondWindow = await dashboard.evaluate((url) => chrome.windows.create({ url:[url, "https://www.w3.org/"] , left:0, top:0, width:1728, height:1117 }), `${origin}/second`);
await wait(4200);

await dashboard.evaluate((windowId) => chrome.runtime.sendMessage({ type:"merge", windowId }), mainWindowId);
await wait(5000);
await dashboard.bringToFront();
await banner("Second window merged into the main tab strip", "All normal windows consolidated; the protected pinned tab is still present");
await wait(5200);

await banner("Verified in the real browser", "Native groups, deduplication, new-tab automation, window merge, and pinned protection");
await wait(4200);

recorder.stdin.write("q");
await new Promise((resolve) => recorder.once("close", resolve));
await context.close();
await new Promise((resolve) => server.close(resolve));
console.log(rawVideo);
