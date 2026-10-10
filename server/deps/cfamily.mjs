// C, C++, Objective-C: `#include "x.h"` (and `#import`) leads to the header next to the file, or
// else to the repo file whose path ends with it, since include directories come from the build
// system. `<x.h>` only counts when the repo has such a file (a vendored or project header).

import { dirOf, joinRepo, tailIndex } from "./common.mjs";

const INCLUDE = /^[ \t]*#[ \t]*(?:include|import)[ \t]*([<"])([^>"\n]+)[>"]/gm;

export default {
  id: "cfamily",
  ext: /\.(c|h|cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+|ipp|inl|tpp|m|mm)$/i,
  edges(sources, { files }) {
    const byTail = tailIndex([...files]);
    const out = [];
    for (const [p, text] of sources) {
      // Block comments out (a commented-out include is no dependency); `//` cannot precede `#`.
      const src = text.replace(/\/\*[\s\S]*?\*\//g, " ");
      for (const [, kind, spec] of src.matchAll(INCLUDE)) {
        const local = kind === '"' ? joinRepo(dirOf(p), spec) : null;
        const hit = local && files.has(local) ? local : byTail(spec.replace(/^(\.\.?\/)+/, ""), p);
        if (hit) out.push([p, hit]);
      }
    }
    return out;
  },
};
