// Town state bridge for the renderer comparison (specs/08, specs/10): both prototypes (web and
// Godot) poll the same small JSON, so the agent logic exists once and the comparison is only about
// rendering.
//
//   node proto/town-render/state.mjs --pack <pack dir> [--skyline http://127.0.0.1:4477] [--port 4478] [--demo]
//
// GET /state -> { now, agents: [{ key, character, building, action, since }], recent: [building ids] }
// GET /pack/<file> -> the town pack's files (so the web prototype needs no other server)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const packDir = path.resolve(arg("--pack", "."));
const skyline = arg("--skyline", "http://127.0.0.1:4477");
const port = Number(arg("--port", 4478));
const demo = args.includes("--demo") || args.includes("--demo-fixed");
const demoFixed = args.includes("--demo-fixed"); // stay on the PoC's sample state (for side-by-side shots)

const pack = JSON.parse(fs.readFileSync(path.join(packDir, "theme.json"), "utf8"));
const buildingIds = pack.variants.night.buildings.map((b) => b.id);
const CHARACTERS = ["hero", "mage", "priest"];
const ACTIVE_MS = 3 * 60_000; // an agent with no event for this long goes home (idle)
const RECENT_MS = 30 * 60_000; // a building written to within this window is "recent"

/** Building that holds a repo path: the longest building id that is the path's folder or above it. */
export function buildingOf(p) {
  if (!p || p.startsWith("/") || /^[a-z]:[\\/]/i.test(p)) return null;
  let best = null;
  for (const id of buildingIds) {
    if (id !== "(root)" && (p === id || p.startsWith(id + "/")) && (!best || id.length > best.length)) best = id;
  }
  return best ?? "(root)";
}

const ACTION = { write: "write", read: "read", search: "read", blocked: "blocked", exec: "exec", prompt: "think", stop: "idle" };
const agents = new Map(); // key -> { key, character, building, action, since, last }
const writes = new Map(); // building -> last write ms

function apply(ev) {
  const t = Date.parse(ev.ts ?? "") || Date.now();
  const p = ev.paths?.[0] ?? null;
  const b = buildingOf(p);
  if (ev.kind === "write" && b) writes.set(b, Math.max(writes.get(b) ?? 0, t));
  if ((ev.source ?? "claude-code") === "watcher") return;
  const key = ev.agent ?? ev.session ?? "unknown";
  let a = agents.get(key);
  if (!a) {
    a = { key, character: CHARACTERS[agents.size % CHARACTERS.length], building: "(root)", action: "idle", since: t, last: t };
    agents.set(key, a);
  }
  const action = ACTION[ev.kind];
  if (!action) return;
  if (b) a.building = b;
  if (a.action !== action) a.since = t;
  a.action = action;
  a.last = t;
}

function state() {
  const now = Date.now();
  const list = [...agents.values()].map((a) => ({
    key: a.key,
    character: a.character,
    building: a.building,
    action: now - a.last > ACTIVE_MS ? "idle" : a.action,
    since: a.since,
  }));
  const recent = [...writes].filter(([, t]) => now - t < RECENT_MS).map(([b]) => b);
  return { now, agents: list, recent };
}

// --demo: three made-up agents walk between buildings, so both prototypes can be measured and
// compared without real work going on.
function runDemo() {
  const script = [
    ["a1", "write", "web/src/city/x.js"], ["a2", "read", "specs/09.md"], ["a3", "blocked", "install/x.sh"],
    ["a1", "write", "web/src/lib/y.js"], ["a2", "read", "docs/a.md"], ["a3", "read", "server/s.mjs"],
    ["a1", "exec", null], ["a2", "write", "web/src/ui/z.jsx"], ["a3", "write", "lib/paths.mjs"],
  ];
  let i = 0;
  const step = () => {
    for (let k = 0; k < 3; k++) {
      const [agent, kind, p] = script[i * 3 + k];
      apply({ ts: new Date().toISOString(), agent, kind, paths: p ? [p] : [] });
    }
    i = (i + 1) % 3;
  };
  step();
  // fixed: repeat the first state so the agents never time out
  setInterval(demoFixed ? () => ((i = 0), step()) : step, demoFixed ? 30_000 : 6000);
}

async function follow() {
  for (;;) {
    try {
      const res = await fetch(skyline + "/api/events");
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of block.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                apply(JSON.parse(line.slice(6)));
              } catch {
                // not an event
              }
            }
          }
        }
      }
    } catch {
      // skyline not running: retry
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const TYPES = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-z]:)/i, "$1"));
// URL prefix -> folder: the town pack, the web prototype, and three.js from the web app's install
const ROOTS = [
  ["/pack/", packDir],
  ["/three/", path.resolve(here, "../../web/node_modules/three")],
  ["/", path.join(here, "web")],
];

function serveFile(res, root, rel) {
  const f = path.resolve(root, decodeURIComponent(rel || "index.html"));
  if (!(f === root || f.startsWith(root + path.sep)) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.pathname === "/state") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(state()));
      return;
    }
    for (const [prefix, root] of ROOTS) {
      if (url.pathname.startsWith(prefix)) {
        serveFile(res, root, url.pathname.slice(prefix.length));
        return;
      }
    }
    res.writeHead(404).end();
  })
  .listen(port, "127.0.0.1", () => console.log(`town state on http://127.0.0.1:${port}/state (${demo ? "demo" : skyline})`));

if (demo) runDemo();
else follow();
