// Minimal glob matcher, pure. Whole-string match against a "/"-separated path.
//   **  any number of path segments, including zero (a/** matches a and a/b/c)
//   *   any characters except /
//   ?   one character except /
//   .   literal; regex metacharacters are escaped
// Case-insensitive so Windows drive-letter / case differences do not matter.

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeChar(c) {
  return c.replace(REGEX_META, "\\$&");
}

// Translate the glob body (no anchors) into a regex fragment. Assumes any
// trailing "/**" or bare "**" has already been handled by toRegex.
function inner(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**" in the middle: zero or more whole segments, each ending in "/".
        out += "(?:[^/]+/)*";
        i++;
        if (glob[i + 1] === "/") i++; // consume the following "/" once
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "/") {
      out += "/";
    } else {
      out += escapeChar(c);
    }
  }
  return out;
}

function toRegex(glob) {
  // A bare "**" or a trailing "/**" matches the thing itself and everything
  // under it: "a/**" must match "a", not just "a/...".
  if (glob === "**") return /^.*$/i;
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3); // drop the trailing "/**"
    return new RegExp("^" + inner(prefix) + "(?:/.*)?$", "i");
  }
  return new RegExp("^" + inner(glob) + "$", "i");
}

export function matchGlob(glob, path) {
  if (typeof glob !== "string" || typeof path !== "string") return false;
  return toRegex(glob).test(path);
}
