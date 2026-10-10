// Generate a synthetic repo for performance testing: N files spread over nested folders.
// usage: node make-repo.mjs <dir> <files>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [dir, nArg] = process.argv.slice(2);
const n = Number(nArg);
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const tops = ["src", "test", "docs", "packages", "tools", "config", "assets", "services"];
for (let i = 0; i < n; i++) {
  const depth = 1 + Math.floor(rnd() * 4);
  const parts = [tops[Math.floor(rnd() * tops.length)]];
  for (let d = 1; d < depth; d++) parts.push(`m${Math.floor(rnd() * 12)}`);
  const file = path.join(dir, ...parts, `f${i}.${["ts", "cs", "md", "json"][i % 4]}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x\n".repeat(1 + Math.floor(rnd() * 400)));
}
execFileSync("git", ["init", "-q"], { cwd: dir });
// stdio ignored: on Windows, git prints one CRLF warning per file, which overflows the buffer.
execFileSync("git", ["-c", "core.autocrlf=false", "add", "-A"], { cwd: dir, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=p@p", "-c", "user.name=p", "commit", "-q", "-m", "init"], { cwd: dir, stdio: "ignore" });
console.log(`made ${n} files in ${dir}`);
