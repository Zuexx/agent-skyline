// PHP: a file uses a class (or interface, trait, enum) when it names it and the class is in its
// own namespace, imported with `use A\B\C` (possibly `as D`, or grouped as `use A\{B, C}`), or
// written fully qualified (`\A\B\C`). `require`/`include` of a literal path counts too.

import { dirOf, joinRepo, namespaceEdges } from "./common.mjs";

const split = (name) => {
  const i = name.lastIndexOf("\\");
  return i < 0 ? ["", name] : [name.slice(0, i), name.slice(i + 1)];
};

function parse(code) {
  const singles = new Map();
  const forced = [];
  for (const m of code.matchAll(/^\s*use\s+(?:function\s+|const\s+)?\\?([\w\\]+?)(?:\\\{([^}]*)\})?(?:\s+as\s+(\w+))?\s*;/gm)) {
    const [, path, group, as] = m;
    if (group)
      for (const part of group.split(",")) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (name) {
          const [ns, cls] = split(`${path}\\${name.trim()}`);
          singles.set(alias?.trim() || cls, [ns, cls]);
        }
      }
    else {
      const [ns, cls] = split(path);
      singles.set(as ?? cls, [ns, cls]);
    }
  }
  for (const m of code.matchAll(/(?<![\w\\])\\((?:\w+\\)+)([A-Z]\w*)/g)) forced.push([m[1].slice(0, -1), m[2]]);
  return {
    ns: code.match(/^\s*namespace\s+([\w\\]+)/m)?.[1] ?? "",
    singles,
    forced,
    types: [...code.matchAll(/\b(?:class|interface|trait|enum)\s+([A-Z]\w*)/g)].map((m) => m[1]),
    idents: new Set(code.match(/\b[A-Z]\w*\b/g) ?? []),
  };
}

export default {
  id: "php",
  ext: /\.php$/i,
  edges(sources, { files }) {
    const out = [];
    const parsed = new Map();
    for (const [p, text] of sources) {
      const noComments = text.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\/[^\n]*|#(?!\[)[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? " ");
      for (const m of noComments.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(__DIR__\s*\.\s*)?["']([^"'\n]+\.php)["']/g)) {
        // Relative to the file: exact with __DIR__, the usual case without it.
        const hit = joinRepo(dirOf(p), m[2].replace(/^\//, ""));
        if (hit && files.has(hit)) out.push([p, hit]);
      }
      parsed.set(p, parse(noComments.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ")));
    }
    out.push(...namespaceEdges(parsed));
    return out;
  },
};
