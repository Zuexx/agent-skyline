// Electron shell around the web town renderer, for the desktop-window comparison (specs/08):
// pin on top, whole-window opacity, frameless, resizable.
//   electron . --url=<page> [--size=WxH] [--on-top] [--opacity=0.8] [--frameless] [--uncapped]
//              [--bench] (prints "BENCH {...}" from the page and quits) [--shot=<png>]
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

const opt = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
if (opt.uncapped) {
  app.commandLine.appendSwitch("disable-gpu-vsync");
  app.commandLine.appendSwitch("disable-frame-rate-limit");
}
app.commandLine.appendSwitch("enable-precise-memory-info");

app.whenReady().then(async () => {
  const [w, h] = (opt.size ?? "1920x960").split("x").map(Number);
  const win = new BrowserWindow({
    width: w,
    height: h,
    useContentSize: true,
    frame: !opt.frameless,
    alwaysOnTop: !!opt["on-top"],
    backgroundColor: "#0a1022",
    resizable: true,
    show: true,
    webPreferences: { backgroundThrottling: false },
  });
  if (opt.opacity) win.setOpacity(Number(opt.opacity)); // whole-window opacity (Windows, macOS)
  win.webContents.on("console-message", (e) => {
    const m = e.message ?? "";
    if (!m.includes("THREE.Clock") && !m.includes("X3595")) console.log("[page] " + m.slice(0, 300));
  });
  await win.loadURL(opt.url);
  if (opt.bench || opt.shot) {
    const wait = async (expr) => {
      for (;;) {
        const v = await win.webContents.executeJavaScript(expr).catch(() => null);
        if (v) return v;
        await new Promise((r) => setTimeout(r, 250));
      }
    };
    if (opt.shot) {
      await wait("window.__ready");
      await new Promise((r) => setTimeout(r, 1500));
      fs.writeFileSync(opt.shot, (await win.webContents.capturePage()).toPNG());
    }
    if (opt.bench) console.log("BENCH " + JSON.stringify(await wait("window.__bench")));
    app.quit();
  }
});
