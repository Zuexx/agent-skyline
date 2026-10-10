// Java, Kotlin and Scala, as one group since they call each other: a file uses a type when it
// names it and the type is in its own package, imported by name (`import a.b.C`, `import a.b.C as
// D`) or imported with its package (`import a.b.*`, Scala `a.b._`). Kotlin top-level functions
// count as declarations too. A static import depends on its class whatever the file names.

import { namespaceEdges, stripCLike } from "./common.mjs";

function parse(text, isKotlin) {
  const src = stripCLike(text);
  const opens = [];
  const singles = new Map();
  const forced = [];
  const single = (path, local) => {
    const i = path.lastIndexOf(".");
    if (i > 0) singles.set(local ?? path.slice(i + 1), [path.slice(0, i), path.slice(i + 1)]);
  };
  for (const m of src.matchAll(/^\s*import\s+(static\s+)?([\w.]+?)(\.\*|\._|\.\{[^}\n]*\})?(?:\s+as\s+(\w+))?\s*;?\s*$/gm)) {
    const [, isStatic, path, tail, as] = m;
    if (isStatic) {
      // `import static a.b.C.m` and `a.b.C.*`: the class is a.b.C.
      const cls = tail ? path : path.slice(0, path.lastIndexOf("."));
      const i = cls.lastIndexOf(".");
      if (i > 0) forced.push([cls.slice(0, i), cls.slice(i + 1)]);
    } else if (tail === ".*" || tail === "._") opens.push(path);
    else if (tail) {
      // Scala `import a.b.{C, D => E}`.
      for (const part of tail.slice(2, -1).split(",")) {
        const [name, renamed] = part.split("=>").map((s) => s.trim());
        if (name === "_") opens.push(path);
        else if (name) singles.set(renamed && renamed !== "_" ? renamed : name, [path, name]);
      }
    } else single(path, as);
  }
  const types = [...src.matchAll(/\b(?:class|interface|enum|record|object|trait|typealias|type)\s+([A-Z]\w*)/g)].map((m) => m[1]);
  if (isKotlin) for (const m of src.matchAll(/^(?:(?:public|internal|inline|suspend|operator|infix)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([a-z]\w*)/gm)) types.push(m[1]);
  return {
    ns: src.match(/^\s*package\s+([\w.]+)/m)?.[1] ?? "",
    opens,
    singles,
    forced,
    types,
    idents: new Set(src.match(isKotlin ? /\b[A-Za-z_]\w*\b/g : /\b[A-Z]\w*\b/g) ?? []),
  };
}

export default {
  id: "jvm",
  ext: /\.(java|kt|kts|scala)$/i,
  edges: (sources) => namespaceEdges(new Map([...sources].map(([p, t]) => [p, parse(t, /\.kts?$/i.test(p))]))),
};
