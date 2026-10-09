// usage: node perf.mjs <url> [seconds-to-settle]
// Opens the page in real Chrome (GPU on), measures FPS, then takes a CPU profile and prints the
// functions with the most self time.
import { chromium } from "playwright-core";

const [url, settleArg = "8", mode = ""] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => localStorage.setItem("codecity.prefs", JSON.stringify({ theme: "night", locale: "en" })));
const t0 = Date.now();
await page.goto(url);
await page.waitForSelector("canvas", { timeout: 60000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(Number(settleArg) * 1000);
if (mode === "replay") {
  await page.getByRole("button", { name: /Replay this session/ }).click();
  await page.waitForTimeout(1500);
}

const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
const fps = await page.evaluate(
  () =>
    new Promise((r) => {
      let n = 0;
      const t = performance.now();
      (function f() {
        n++;
        if (performance.now() - t < 3000) requestAnimationFrame(f);
        else r(Math.round(n / 3));
      })();
    })
);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
await page.waitForTimeout(4000);
const { profile } = await cdp.send("Profiler.stop");
const self = new Map();
const dt = profile.timeDeltas ?? [];
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
const heap = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
console.log(JSON.stringify({ url, loadMs, fps, heapMB: heap, gpu }, null, 0));
for (const [k, ms] of top) console.log(`${((ms / total) * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(6)}ms  ${k}`);
await browser.close();
