// Stop Agent Skyline servers that `skyline` or the SessionStart hook started, by the PID each one
// recorded. Never by process name: other Node programs on the machine are left alone.
//
//   node cli/stop-server.mjs            list recorded servers
//   node cli/stop-server.mjs <port>     stop the one on that port
//   node cli/stop-server.mjs --all      stop all of them

import { resolveServersDir } from "../lib/paths.mjs";
import { listServers, stopServer } from "../lib/autostart.mjs";

const records = listServers(resolveServersDir());

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
  const result = await stopServer(r);
  if (result === "stopped") console.log(`stopped port ${r.port} (pid ${r.pid})`);
  else if (result === "gone") console.log(`port ${r.port}: not running any more (or the PID belongs to something else); record removed`);
  else console.error(result);
}
