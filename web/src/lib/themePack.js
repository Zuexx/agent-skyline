// Theme pack handling for the page (specs/06-themes.md): checking a loaded theme.json, filling
// what it leaves out from the built-in `blocks` pack, and picking the palette for a variant.
// Pure, no fetching here — see useThemePack.js.

import { manifestErrors } from "../../../lib/themeManifest.mjs";

/**
 * { ok, pack, errors } for a parsed theme.json from folder `id`. Each variant's palette is completed
 * with `fallback`'s palette of the same variant name (else its first variant), so a pack only has
 * to set the colors it changes.
 */
export function validatePack(json, id, fallback) {
  const errors = manifestErrors(json, id);
  if (errors.length) return { ok: false, pack: null, errors };
  const base = (name) => (fallback.variants[name] ?? Object.values(fallback.variants)[0]).palette;
  const variants = Object.fromEntries(
    Object.entries(json.variants).map(([name, v]) => [name, { ...v, palette: { ...base(name), ...v.palette } }])
  );
  return { ok: true, pack: { ...json, variants }, errors: [] };
}

/**
 * The palette for `want` ("night" | "day"): that variant when the pack has it, else the pack's
 * first variant (a pack with a single look ignores the night/day setting). Returns { palette, variant }.
 */
export function resolvePalette(pack, want) {
  const names = Object.keys(pack.variants);
  const variant = names.includes(want) ? want : names[0];
  return { palette: pack.variants[variant].palette, variant };
}

/** A pack's display name in `locale`, falling back to English, then to its id. */
export function packName(info, locale) {
  const n = info?.name;
  if (typeof n === "string") return n;
  return n?.[locale] ?? n?.en ?? info?.id ?? "";
}
