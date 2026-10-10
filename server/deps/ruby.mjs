// Ruby: `require_relative "x"` leads to x.rb next to the file, `require "a/b"` to the repo file
// ending in a/b.rb. Code that relies on autoloading (Rails, Zeitwerk) names constants instead, so
// a file also uses the files that declare a `class` or `module` it names.

import { dirOf, joinRepo, namespaceEdges, tailIndex } from "./common.mjs";

const withRb = (s) => (/\.rb$/i.test(s) ? s : `${s}.rb`);

export default {
  id: "ruby",
  ext: /\.(rb|rake)$/i,
  edges(sources, { files }) {
    const byTail = tailIndex([...files]);
    const out = [];
    const parsed = new Map();
    for (const [p, text] of sources) {
      for (const m of text.matchAll(/^\s*require(_relative)?\s*\(?\s*["']([^"'\n]+)["']/gm)) {
        const hit = m[1] ? joinRepo(dirOf(p), withRb(m[2])) : byTail(withRb(m[2]), p);
        if (hit && files.has(hit)) out.push([p, hit]);
      }
      // Comments and strings out (a `#` inside a string is not a comment, so strings go first).
      const src = text.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, " ").replace(/#[^\n]*/g, " ");
      parsed.set(p, {
        ns: "",
        types: [...src.matchAll(/^\s*(?:class|module)\s+(?:[A-Z]\w*::)*([A-Z]\w*)/gm)].map((m) => m[1]),
        idents: new Set(src.match(/\b[A-Z]\w*\b/g) ?? []),
      });
    }
    out.push(...namespaceEdges(parsed));
    return out;
  },
};
