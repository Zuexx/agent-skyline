// Record the CodeCity demo video.
//
//   node record.mjs --out demo.mp4 --repo-dir <forgekit clone> --url http://127.0.0.1:4490/ --events <file>
//                   --big-url http://127.0.0.1:4491/ --big-events <file>
//
// The servers behind --url (a throwaway clone of forgekit, given as --repo-dir) and --big-url (a
// 20k-file repo) must already run with CODECITY_EVENTS pointing at --events / --big-events (fresh,
// empty files). This script drives the real app in Chrome, writes the story's events into those
// logs, records the screen, and makes the agent's edits for real in the clone, so the uncommitted
// diffs on screen are real diffs. Never point --repo-dir at a repo you care about.
//
// Recording: Chrome's screencast (CDP) delivers rendered frames; a clock writes the latest frame
// to ffmpeg at a constant 30 fps, so the video runs in real time whatever the frame delivery does.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cards from "./cards.mjs";
import { rootKey } from "../lib/normalize.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const OUT = arg("out", "demo.mp4");
const URL_MAIN = arg("url", "http://127.0.0.1:4490/");
const EVENTS = arg("events");
const URL_BIG = arg("big-url", "http://127.0.0.1:4491/");
const BIG_EVENTS = arg("big-events");
const REPO_DIR = arg("repo-dir");
if (!REPO_DIR) throw new Error("--repo-dir <throwaway forgekit clone> is required");
const ROOT = rootKey(path.resolve(REPO_DIR));
const FPS = 30;
const W = 1920;
const H = 1080;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- browser and recorder ----------
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(URL_MAIN).origin });
await page.addInitScript(() => localStorage.setItem("codecity.prefs", JSON.stringify({ theme: "night", locale: "zh-TW", notify: false })));
await page.addInitScript({ content: readFileSync(path.join(here, "overlay.js"), "utf8") });

const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });

let last = null;
let cdp = null;
async function startScreencast() {
  cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f) => {
    last = Buffer.from(f.data, "base64");
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
    } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
}
let written = 0;
let t0 = 0;
const clock = setInterval(() => {
  if (!last || !t0) return;
  const due = Math.floor(((Date.now() - t0) / 1000) * FPS);
  while (written < due) {
    ff.stdin.write(last);
    written++;
  }
}, 1000 / FPS / 2);

// ---------- helpers ----------
const ui = (fn, ...args) => page.evaluate(([f, a]) => window.__demo?.[f]?.(...a), [fn, args]);
async function caption(zhText, enText, holdMs) {
  await ui("caption", zhText, enText);
  if (holdMs) await sleep(holdMs);
}
const hideCaption = () => ui("hideCaption");
async function card(html, holdMs) {
  await ui("card", html);
  await sleep(holdMs);
  await ui("hideCard");
  await sleep(700);
}

let mouse = { x: W / 2, y: H / 2 };
async function moveTo(x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  const sx = mouse.x;
  const sy = mouse.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
    await sleep(ms / steps);
  }
  mouse = { x, y };
}
async function clickAt(x, y, opts = {}) {
  await moveTo(x, y, opts.ms ?? 700);
  await sleep(150);
  if (opts.double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
  await sleep(250);
}
async function clickLocator(loc, opts) {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error(`not visible: ${loc}`);
  await clickAt(b.x + b.width / 2, b.y + b.height / 2, opts);
}
const button = (name) => page.getByRole("button", { name });
async function screenOf(p) {
  return page.evaluate((x) => window.__codecityDemo?.screenOf(x) ?? null, p);
}
async function hoverPath(p, ms) {
  const s = await screenOf(p);
  if (s) await moveTo(s.x, s.y + 4, ms);
}
async function clickPath(p, opts) {
  const s = await screenOf(p);
  if (!s) throw new Error(`no building on screen for ${p}`);
  await clickAt(s.x, s.y + 4, opts);
}

// Story events, in the hook's own format.
function emit(file, ev) {
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), agent: null, event: "PostToolUse", detail: null, root: ROOT, ...ev }) + "\n");
}
const claude = (kind, tool, p, extra = {}) =>
  emit(EVENTS, { session: "demo-claude-1", source: "claude-code", kind, tool, paths: p ? [p] : [], ...extra });
const pi = (kind, tool, p, extra = {}) => emit(EVENTS, { session: "pi-demo-1", source: "pi", kind, tool, paths: p ? [p] : [], ...extra });

// The agent's edits, made for real in the clone (keeping the file's line endings).
const EDITS = {
  "api/Anvil/Foundations/JwksProvider.cs": [
    ["private readonly HttpClient _httpClient = new();", "private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(10) };"],
    ["if (jwks?.Keys == null) return null;", "if (jwks?.Keys is not { Length: > 0 }) return null;"],
  ],
  "api/Anvil/Interfaces/IJwksProvider.cs": [
    [
      "        Task<SecurityKey?> GetKeyByIdAsync(string kid);",
      "        /// <summary>Returns the signing key with this key id, or null when the JWKS has none.</summary>\n        Task<SecurityKey?> GetKeyByIdAsync(string kid);",
    ],
  ],
  "api/Anvil/Middlewares/ExceptionHandlingMiddleware.cs": [
    [
      "        var correlationId = ExtractCorrelationId(context);",
      "        var correlationId = ExtractCorrelationId(context);\n        context.Response.Headers[CorrelationIdHeaderName] = correlationId;",
    ],
  ],
  "docs/adr/README.md": [["## What is an ADR?", "See also `docs/api/API_ERRORS.md` for the error contract.\n\n## What is an ADR?"]],
};
function applyEdit(rel) {
  const file = path.join(REPO_DIR, ...rel.split("/"));
  let text = readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [find, replace] of EDITS[rel] ?? []) {
    const f = find.replace(/\n/g, eol);
    if (!text.includes(f)) throw new Error(`demo edit: "${find}" not found in ${rel}`);
    text = text.replace(f, replace.replace(/\n/g, eol));
  }
  writeFileSync(file, text);
}
// A write in the story: change the file, then report it the way the PostToolUse hook would.
const claudeWrite = (p) => {
  applyEdit(p);
  claude("write", "Edit", p);
};

// ---------- the story ----------
await page.goto(URL_MAIN + "?demo");
await page.waitForSelector("canvas");
await startScreencast();
await sleep(1500);
t0 = Date.now();

// 1. Title and problem
await card(cards.title, 5200);
await card(cards.problem, 6500);

// 2. The city
await caption("把 repo 畫成一座城市", "A repo, drawn as a city", 2600);
await caption("資料夾是街區,檔案是大樓,大樓高度是行數", "Folders are districts, files are buildings, height is line count", 1000);
await hoverPath("api/ForgeKit.Api/Program.cs", 1200);
await sleep(1500);
await hoverPath("api/Anvil/Foundations/JwksProvider.cs", 1000);
await sleep(1600);
// Rotate a little (right-drag) to show it is a real 3D scene.
await moveTo(1250, 620, 600);
await page.mouse.down({ button: "right" });
await moveTo(1050, 600, 1600);
await page.mouse.up({ button: "right" });
await sleep(600);
await clickLocator(button(/回到能看到整座城市/));
await sleep(900);

// 3. Grouping
await caption("同一批檔案,可以換一種分法", "The same files, grouped another way", 600);
await clickLocator(page.getByRole("radio", { name: "角色" }));
await sleep(2600);
await caption("依角色分組:程式碼、測試、規格、文件、設定", "By role: code, tests, specs, docs, config", 3200);
await clickLocator(page.getByRole("radio", { name: "資料夾" }));
await sleep(2200);
await hideCaption();

// 4. Live activity
await caption("即時看到 agent 讀了什麼、改了什麼", "See what the agent reads and writes, live", 400);
await clickLocator(button(/鏡頭跟隨/));
const anvil = "api/Anvil";
const live = [
  () => claude("read", "Read", "api/ForgeKit.Api/Program.cs"),
  () => pi("read", "Read", "README.md"),
  () => claude("read", "Read", `${anvil}/Foundations/JwksProvider.cs`),
  () => claude("exec", "Bash", null, { detail: `grep -n "kid" ${anvil}/Foundations/JwksProvider.cs` }),
  () => pi("read", "Read", "docs/api/API_ERRORS.md"),
  () => claude("read", "Read", `${anvil}/Interfaces/IJwksProvider.cs`),
  () => claude("read", "Read", `${anvil}/Extensions/ConfigureJwtBearerOptions.cs`),
  () => claudeWrite(`${anvil}/Foundations/JwksProvider.cs`),
  () => pi("read", "Read", `${anvil}/Models/ErrorResponse.cs`),
  () => claudeWrite(`${anvil}/Interfaces/IJwksProvider.cs`),
  () => claude("read", "Read", `${anvil}/Middlewares/ExceptionHandlingMiddleware.cs`),
  () => claudeWrite(`${anvil}/Middlewares/ExceptionHandlingMiddleware.cs`),
];
for (const [i, step] of live.entries()) {
  step();
  if (i === 4) await caption("光柱指出 agent 正在處理的檔案:Claude 是倒錐,pi 是菱形", "A beam marks the file each agent is on — cone for Claude, diamond for pi");
  if (i === 8) await caption("藍色是剛讀過,琥珀色是改過", "Blue: just read · Amber: written");
  await sleep(1300);
}
await sleep(1200);
await clickLocator(button(/鏡頭跟隨/)); // follow off before clicking in the scene
await clickLocator(button(/回到能看到整座城市/));
await sleep(900);

// 4b. Dependency roads
await caption("點一棟大樓,看它的依賴道路", "Click a building to see its roads", 300);
await clickPath("api/ForgeKit.Api/Data/AppDbContext.cs");
await sleep(1200);
await caption("紫色:它用到的 · 粉紅:用到它的 · 綠色:它的測試", "Violet: what it uses · Pink: what uses it · Green: its tests", 4200);
await caption("不需要編譯器或索引:直接讀 import 和 C# 型別", "No compiler or index needed: imports and C# type use, read directly", 3200);
await page.keyboard.press("Escape");
await hideCaption();
await sleep(500);

// 5. Locked zones — fly in close first, so the block reads clearly
await clickPath(`${anvil}/Middlewares/CorrelationIdMiddleware.cs`, { double: true });
await sleep(1800);
await page.keyboard.press("Escape");
await caption("禁區:鎖住不准 agent 修改的資料夾", "Locked zones: folders an agent may not change", 600);
await clickLocator(button(/禁區設定/));
await sleep(1800);
await clickPath(`${anvil}/Middlewares/CorrelationIdMiddleware.cs`);
await sleep(1400);
await clickLocator(page.getByRole("button", { name: "完成" }));
await sleep(800);
await caption("pi 想改禁區裡的檔案 — 寫入前就被擋下", "pi tries to edit a locked file — blocked before the write", 300);
pi("read", "Read", `${anvil}/Middlewares/CorrelationIdMiddleware.cs`);
await sleep(900);
pi("blocked", "Edit", `${anvil}/Middlewares/CorrelationIdMiddleware.cs`, {
  event: "PreToolUse",
  detail: `codecity: ${anvil}/Middlewares/CorrelationIdMiddleware.cs is in locked zone "${anvil}/Middlewares/**"`,
});
await sleep(3800);
await caption("實測時,被擋下的 agent 改用 echo > file 繞道 — 現在 shell 指令也擋得住", "In testing, a blocked agent retried with echo > file — shell writes are blocked too now", 300);
pi("blocked", "Bash", `${anvil}/Middlewares/CorrelationIdMiddleware.cs`, {
  event: "PreToolUse",
  detail: `codecity: this command would modify ${anvil}/Middlewares/CorrelationIdMiddleware.cs, which is in locked zone "${anvil}/Middlewares/**"`,
});
await sleep(4500);

// 6. Scope check
await caption("範圍檢查:沒宣告範圍也會推論", "Scope check: inferred even when nothing was declared", 600);
claudeWrite("docs/adr/README.md");
await sleep(1200);
await clickLocator(button(/回到能看到整座城市/));
await sleep(900);
await clickPath("docs/adr/README.md", { double: true });
await sleep(1500);
await page.keyboard.press("Escape");
await caption("一直在 api 裡工作,突然改到 docs → 跳出警示", "Working in api all along, then a change in docs → a warning", 3800);
await hideCaption();

// 6b. Review list and uncommitted diffs
await caption("Review 清單:這次改過的檔案,依風險排序", "The review list: this session's changes, riskiest first", 300);
await clickLocator(button(/Review 清單/));
await sleep(1500);
await caption("每一個都附理由:有警示、沒有測試、很多檔案依賴…", "Each with its reasons: a warning, no tests, many dependents…", 3600);
await clickLocator(page.locator(`button[title="${anvil}/Foundations/JwksProvider.cs"]`));
await sleep(1800);
await clickLocator(page.getByRole("button", { name: "查看 diff" }));
await caption("還沒 commit 的改動,點一下就看 diff", "Uncommitted changes: one click shows the diff", 4600);
await page.keyboard.press("Escape");
await clickLocator(page.locator('button[title="關閉,回到即時動態"]'));
await hideCaption();
await sleep(600);

// 7. Compare a branch
await clickLocator(button(/回到能看到整座城市/));
await caption("比較分支:這次修正到底改了什麼?", "Compare a branch: what did this fix actually change?", 400);
const compareSelect = page.locator("select").first();
await clickLocator(compareSelect);
await compareSelect.selectOption("fix/api-error-and-jwks-hardening");
await sleep(2800);
await caption("新增是綠色、修改是琥珀色;左上是摘要", "Added in green, modified in amber; the summary is top left", 3200);
await clickLocator(page.getByRole("radio", { name: "角色" }));
await sleep(2600);
await caption("依角色看:改了程式碼,也補了測試", "By role: the code changed, and tests came with it", 3000);
await clickPath("api/Anvil.Tests/Foundations/JwksProviderTests.cs", { double: true }); // fly in; it also selects
await sleep(1800);
await clickLocator(page.getByRole("button", { name: "查看 diff" }));
await caption("點一棟大樓,直接看 diff", "Click a building to read its diff", 4200);
await page.keyboard.press("Escape");
await clickLocator(page.locator('button[title="結束比較"]'));
await sleep(1500);
await clickLocator(page.getByRole("radio", { name: "資料夾" }));
await sleep(1500);

// 7b. Box-select a task
await caption("框選派工:選幾棟大樓,變成給 agent 的任務", "Assign a task: pick buildings, hand them to an agent", 300);
// Fly in close first, so the box catches just the Extensions folder and the picks are visible.
await clickPath(`${anvil}/Extensions/CorsExtensions.cs`, { double: true });
await sleep(1800);
await page.keyboard.press("Escape");
await clickLocator(button(/框選派工/));
await sleep(600);
{
  const targets = [];
  for (const f of ["ConfigureJwtBearerOptions.cs", "CorsExtensions.cs", "ModuleExtension.cs", "PlatformServiceExtensions.cs", "ResultEndpointExtensions.cs"]) {
    const s = await screenOf(`${anvil}/Extensions/${f}`);
    if (s) targets.push(s);
  }
  if (!targets.length) throw new Error("no Extensions buildings on screen");
  const pad = 26;
  const x0 = Math.min(...targets.map((s) => s.x)) - pad;
  const y0 = Math.min(...targets.map((s) => s.y)) - pad;
  const x1 = Math.max(...targets.map((s) => s.x)) + pad;
  const y1 = Math.max(...targets.map((s) => s.y)) + pad + 20;
  await moveTo(x0, y0, 700);
  await page.mouse.down();
  await moveTo(x1, y1, 1400);
  await page.mouse.up();
}
await sleep(900);
await clickLocator(page.locator("textarea"));
await page.keyboard.type("幫這幾個擴充方法補單元測試", { delay: 70 });
await sleep(500);
await clickLocator(page.getByRole("button", { name: "複製任務" }));
await caption("複製後貼到 Claude Code:任務 + 檔案範圍", "Copy, paste into Claude Code: the task plus its file scope", 3400);
await clickLocator(page.getByRole("button", { name: "設為任務範圍" }));
await caption("或直接設成任務範圍:改到範圍外的檔案就警示", "Or make it the task scope: changes outside it raise a warning", 3600);
await clickLocator(page.getByRole("button", { name: "清除選取" }));
await hideCaption();
await sleep(800);

// 8. Replay
await caption("重播:回頭看這次工作是怎麼走的", "Replay: watch how the session unfolded", 400);
await clickLocator(button(/重播這次工作/));
await sleep(800);
await page.locator("select").last().selectOption("8");
await sleep(7000);
await clickLocator(button(/回到即時/));
await sleep(800);

// 9. Theme and language
await caption("夜間、日間;繁中、English", "Night or day; 繁中 or English", 400);
await clickLocator(button(/^主題/));
await sleep(2600);
await clickLocator(button(/語言/));
await sleep(2400);
await clickLocator(button(/Language/));
await sleep(900);
await clickLocator(button(/主題/));
await sleep(600);
await clickLocator(button(/主題/));
await sleep(1600);
await hideCaption();

// 10. Scale
if (BIG_EVENTS) {
  await ui("card", `<div style="font-size:40px;font-weight:700">20,000 個檔案 · 20,000 files</div>`);
  await page.goto(URL_BIG + "?demo");
  await page.waitForSelector("canvas");
  await sleep(1200);
  const files = JSON.parse(await (await fetch(URL_BIG + "api/city")).text()).buildings.map((b) => b.path);
  const big = (kind, p, s) => emit(BIG_EVENTS, { session: s, source: "claude-code", kind, tool: kind === "write" ? "Edit" : "Read", paths: [p], root: undefined });
  // Like a real agent: read a file before editing it (a blind edit would raise a scope warning).
  await ui("hideCard");
  await caption("20,000 個檔案,依然每秒 60 格", "20,000 files, still 60 frames per second", 300);
  for (let i = 0; i < 40; i++) {
    const p = files[(i * 7919) % files.length];
    big("read", p, `big-${i % 3}`);
    if (i % 4 === 0) big("write", p, `big-${i % 3}`);
    await sleep(160);
  }
  await moveTo(1200, 600, 400);
  await page.mouse.down({ button: "right" });
  await moveTo(900, 560, 2200);
  await page.mouse.up({ button: "right" });
  await sleep(1500);
  await hideCaption();
}

// 11. How it works, outro
await card(cards.architecture, 8000);
await card(cards.outro, 6000);

clearInterval(clock);
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`wrote ${OUT}: ${written} frames, ${(written / FPS).toFixed(1)} s`);
