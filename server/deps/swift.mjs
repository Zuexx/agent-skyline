// Swift: files of a module see each other without imports, so a file uses the files that declare
// a type it names (class, struct, enum, protocol, actor, typealias). All Swift files of the repo
// are treated as one module: two modules that declare the same type name can add a wrong road.

import { namespaceEdges, stripCLike } from "./common.mjs";

function parse(text) {
  const src = stripCLike(text);
  return {
    ns: "",
    types: [...src.matchAll(/\b(?:class|struct|enum|protocol|actor|typealias)\s+([A-Z]\w*)/g)].map((m) => m[1]),
    idents: new Set(src.match(/\b[A-Z]\w*\b/g) ?? []),
  };
}

export default {
  id: "swift",
  ext: /\.swift$/i,
  edges: (sources) => namespaceEdges(new Map([...sources].map(([p, t]) => [p, parse(t)]))),
};
