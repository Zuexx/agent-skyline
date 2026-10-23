// The live palette every component reads. Colors come from the chosen theme pack's variant
// (specs/06-themes.md; packs are listed by /api/themes and loaded by lib/useThemePack.js):
// - night: the idle city stays dark and activity glows (colors multiplied by `glow` cross the
//   bloom threshold).
// - day: a light city where activity shows as saturated solid color; no bloom, glow = 1.
// The built-in `blocks` pack is bundled too, so the page has colors before any pack loads and
// whenever a pack is broken. `theme` is one live object; applyTheme() swaps its contents, and the
// 3D scene is remounted (keyed by theme.name) so materials pick the new colors up.

import blocksPack from "../public/themes/blocks/theme.json";

export const builtinPack = blocksPack;

export const theme = { name: "blocks:night", ...blocksPack.variants.night.palette };

/** Swap the live palette; `name` ("pack:variant") keys the scene so it rebuilds on a change. */
export function applyTheme(palette, name) {
  for (const k of Object.keys(theme)) delete theme[k];
  Object.assign(theme, palette, { name });
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function rgbToHex(r, g, b) {
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** districtBase with the per-depth lightness offset (HSL percentage points). */
export function districtColor(depth = 0) {
  const steps = theme.districtStep;
  const offset = steps[Math.min(Math.max(0, depth), steps.length - 1)];
  if (!offset) return theme.districtBase;
  const [r, g, b] = hexToRgb(theme.districtBase);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const l2 = Math.min(1, Math.max(0, l + offset / 100));
  const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
  const p = 2 * l2 - q;
  return rgbToHex(hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3));
}

/** Brightness multiplier for a lit color: above 1 at night so bloom picks it up, 1 by day. */
export function lit(k = 1) {
  return theme.bloom ? theme.glow * k : 1;
}
