// C#: a file uses a type when it names it and the type's namespace is visible to it (its own
// namespace and parents, its `using` lines, and any `global using`). Types are found from
// `class/record/interface/enum/struct` declarations. Good enough to say "who uses this", not a
// compiler: a type name that happens to appear in a comment can add an edge.

import { namespaceEdges } from "./common.mjs";

// Comments and string literals (including verbatim @"...") out before looking at identifiers.
const strip = (text) => text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|@"(?:""|[^"])*"|"(?:\\.|[^"\\\n])*"/g, " ");

function parse(text) {
  const src = strip(text);
  const usings = [];
  const globals = [];
  for (const m of src.matchAll(/^\s*(global\s+)?using\s+(?!static\b)([\w.]+)\s*;/gm)) (m[1] ? globals : usings).push(m[2]);
  return {
    ns: src.match(/\bnamespace\s+([\w.]+)/)?.[1] ?? "",
    opens: usings,
    globals,
    types: [...src.matchAll(/\b(?:class|record|interface|enum|struct)\s+([A-Z]\w*)/g)].map((m) => m[1]),
    idents: new Set(src.match(/\b[A-Z]\w*\b/g) ?? []),
  };
}

export default {
  id: "csharp",
  ext: /\.cs$/i,
  edges: (sources) => namespaceEdges(new Map([...sources].map(([p, t]) => [p, parse(t)])), { parents: true }),
};
