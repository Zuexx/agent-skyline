// Files a shell command would create, change, move or delete — so a locked zone cannot be
// bypassed by switching from the Edit tool to `echo > file` (observed with a real agent).
//
// This is a heuristic over common forms, not a shell parser:
//   redirections  > >> 1> 2> &> (also attached: >file)
//   tee [-a] f…   sed -i … f…   perl -i … f…   truncate … f
//   cp/install … dst   mv src… dst (all count)   ln … dst   rm/touch/mkdir f…
//   git checkout -- f…   git restore f…
//   PowerShell: Set-Content / Add-Content / Out-File / Remove-Item / New-Item / Copy-Item / Move-Item
// It cannot see writes made inside interpreters (`python -c`, `node -e`) or scripts; the file
// watcher records those after the fact.
//
// `cd <dir> && …` is followed so relative targets resolve against the right folder.

import path from "node:path";

/** Split into words, honoring single and double quotes. Operators stay separate words. */
function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const SEP = /&&|\|\||;|\||\n/;
const isOpt = (w) => /^-/.test(w);

/** Targets of one simple command (already split into words). */
function commandTargets(w) {
  const t = [];
  // Redirections anywhere in the command.
  for (let i = 0; i < w.length; i++) {
    const m = /^(?:\d|&)?>>?(.*)$/.exec(w[i]);
    if (!m) continue;
    if (m[1]) t.push(m[1]);
    else if (w[i + 1]) t.push(w[++i]);
  }
  const clean = w.filter((x, i) => !/^(?:\d|&)?>>?/.test(x) && !/^(?:\d|&)?>>?$/.test(w[i - 1] ?? ""));
  const [cmd, ...rest] = clean;
  const name = (cmd ?? "").toLowerCase();
  const args = rest.filter((x) => !isOpt(x));
  switch (name) {
    case "tee":
    case "rm":
    case "touch":
    case "mkdir":
    case "rmdir":
    case "truncate":
      t.push(...args);
      break;
    case "sed":
    case "perl":
      if (rest.some((x) => /^-i/.test(x) || /^-[a-z]*i/.test(x))) t.push(...args.slice(1)); // first arg is the script
      break;
    case "cp":
    case "install":
    case "ln":
      if (args.length >= 2) t.push(args[args.length - 1]);
      break;
    case "mv":
      t.push(...args);
      break;
    case "git": {
      const sub = args[0];
      const dd = rest.indexOf("--");
      if (sub === "checkout" && dd >= 0) t.push(...rest.slice(dd + 1));
      if (sub === "restore") t.push(...(dd >= 0 ? rest.slice(dd + 1) : args.slice(1)));
      if (sub === "rm" || sub === "mv") t.push(...args.slice(1));
      break;
    }
    case "set-content":
    case "add-content":
    case "out-file":
    case "remove-item":
    case "new-item":
    case "copy-item":
    case "move-item": {
      const named = (flag) => {
        const i = rest.findIndex((x) => x.toLowerCase() === flag);
        return i >= 0 ? rest[i + 1] : null;
      };
      const dest = named("-destination");
      const p = named("-path") ?? named("-filepath") ?? named("-literalpath") ?? args[0];
      if (name === "copy-item") t.push(dest ?? args[1]);
      else if (name === "move-item") t.push(p, dest ?? args[1]);
      else t.push(p);
      break;
    }
    default:
      break;
  }
  return t.filter((x) => x && x !== "/dev/null" && x.toLowerCase() !== "nul" && x !== "$null");
}

/**
 * Write targets of `command`, as paths relative to the command's starting folder (or absolute,
 * when written absolute), with `/` separators. `cd` segments shift the folder for what follows.
 */
export function bashWriteTargets(command) {
  if (typeof command !== "string" || !command.trim()) return [];
  const out = [];
  let dir = "";
  for (const seg of command.split(SEP)) {
    const w = words(seg.trim());
    if (!w.length) continue;
    if (w[0] === "cd") {
      const to = (w[1] ?? "").replace(/\\/g, "/");
      dir = to.startsWith("/") || /^[a-z]:\//i.test(to) ? to : path.posix.join(dir, to);
      continue;
    }
    for (const raw of commandTargets(w)) {
      const p = raw.replace(/\\/g, "/");
      out.push(p.startsWith("/") || /^[a-z]:\//i.test(p) ? path.posix.normalize(p) : path.posix.join(dir || ".", p));
    }
  }
  return [...new Set(out)];
}
