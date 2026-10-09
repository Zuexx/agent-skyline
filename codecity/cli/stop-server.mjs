// Stop CodeCity servers that the SessionStart hook started, by the PID each one recorded.
// Never by process name: other Node programs on the machine are left alone.
//
//   node cli/stop-server.mjs            list recorded servers
//   node cli/stop-server.mjs <port>     stop the one on that port
//   node cli/stop-server.mjs --all      stop all of them

import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { resolveServersDir } from "../lib/paths.mjs";
import { probe } from "../lib/autostart.mjs";

const dir = resolveServersDir();
let records = [];
try {
  records = readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => ({ file: path.join(dir, f), ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
} catch {
  // no directory yet: nothing was started
}

const arg = process.argv[2];
if (!arg) {
  if (!records.length) console.log("no auto-started servers recorded");
  for (const r of records) console.log(`port ${r.port}  pid ${r.pid}  ${r.repo}  (since ${r.started})`);
  process.exit(0);
}

const targets = arg === "--all" ? records : records.filter((r) => String(r.port) === arg);
if (!targets.length) {
  console.error(`no recorded server on port ${arg}`);
  process.exit(1);
}
for (const r of targets) {
  // Only kill the PID if that port is still a CodeCity with that PID: PIDs get reused.
  const p = await probe(r.port);
  if (p.health?.pid === r.pid) {
    try {
      process.kill(r.pid);
      console.log(`stopped port ${r.port} (pid ${r.pid})`);
    } catch (err) {
      console.error(`could not stop pid ${r.pid}: ${err.message}`);
      continue;
    }
  } else {
    console.log(`port ${r.port}: not running any more (or the PID belongs to something else); record removed`);
  }
  rmSync(r.file, { force: true });
}
