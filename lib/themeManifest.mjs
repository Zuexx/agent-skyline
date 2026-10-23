// What a theme pack's theme.json must hold (specs/06-themes.md). Shared by the server, which lists
// packs, and the page, which loads one, so both judge a pack the same way. Pure, no I/O.

export const RENDERERS = ["blocks", "sprites", "painted"];

/** Problems with a parsed theme.json for the pack in folder `id`: [] when it is usable. */
export function manifestErrors(json, id) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return ["theme.json must be an object"];
  const errors = [];
  if (json.id !== id) errors.push(`id "${json.id}" does not match the folder name "${id}"`);
  if (!RENDERERS.includes(json.renderer)) errors.push(`renderer must be one of ${RENDERERS.join(", ")}`);
  const variants = json.variants;
  if (variants === null || typeof variants !== "object" || Array.isArray(variants) || !Object.keys(variants).length) {
    errors.push("variants must name at least one variant");
  } else {
    for (const [name, v] of Object.entries(variants)) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) errors.push(`variant "${name}" must be an object`);
      else if (json.renderer === "painted") {
        // a painted town (specs/10): the painting and its depth instead of a palette; a palette is optional
        if (typeof v.background?.albedo !== "string" || typeof v.depth !== "string") errors.push(`variant "${name}" needs background.albedo and depth`);
        if (!Array.isArray(v.buildings)) errors.push(`variant "${name}" has no buildings`);
        if (v.palette != null && (typeof v.palette !== "object" || Array.isArray(v.palette))) errors.push(`variant "${name}" palette must be an object`);
      } else if (v.palette === null || typeof v.palette !== "object" || Array.isArray(v.palette)) errors.push(`variant "${name}" has no palette`);
    }
  }
  return errors;
}
