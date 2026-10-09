// All colors live here, in two palettes.
// - night: the idle city stays dark and activity glows (colors multiplied by `glow` cross the
//   bloom threshold).
// - day: a light city where activity shows as saturated solid color; no bloom, glow = 1.
// `theme` is one live object that every component reads; applyTheme() swaps its contents, and the
// 3D scene is remounted so materials pick the new colors up.

export const themes = {
  night: {
    name: "night",
    glow: 2.6, // brightness multiplier for "lit" things (active buildings, pulses, agents)
    bloom: true,
    background: "#060a14",
    ground: "#0a1020",
    districtBase: "#111a2e", // depth-0 slab; each level gets lighter
    districtStep: [0, 3, 6, 9, 12],
    building: "#2a3653", // idle building: dark slate, below the bloom threshold
    buildingHover: "#ffd27a",
    buildingSelected: "#ff8a5c",
    read: "#38c6ff",
    written: "#ffae2b",
    blocked: "#ff3355",
    added: "#3ddc84",
    deleted: "#ff5a6e",
    ping: "#ffffff",
    agentColors: ["#4da3ff", "#2ee6c5", "#b388ff", "#ff5fa2", "#ffb347", "#7dff7a"],
    locked: "#3a1424",
    scope: "#123a2c", // district inside the declared task scope (dark green)
    warn: "#ffd23f", // scope warning cap
    live: "#3ddc84",
    offline: "#5b6780",
    text: "#e6edf7",
    muted: "#8a97b0",
    panelBg: "rgba(10, 16, 32, 0.82)",
    panelBorder: "#26324d",
    hemiSky: "#9cb8ff",
    hemiGround: "#05070d",
    hemiIntensity: 1.1,
    keyLight: "#cfe0ff",
    keyIntensity: 1.3,
    labelTopBg: "rgba(77, 163, 255, 0.22)",
    labelTopBorder: "rgba(77, 163, 255, 0.6)",
    labelTopText: "#ffffff",
  },
  day: {
    name: "day",
    glow: 1,
    bloom: false,
    background: "#eef3f9",
    ground: "#dfe7f2",
    districtBase: "#c9d8ea", // depth-0 slab; each level gets darker
    districtStep: [0, -5, -10, -14, -17],
    building: "#fbfcfe",
    buildingHover: "#ffb454",
    buildingSelected: "#ff6a3d",
    read: "#1f7ae0",
    written: "#e08a00",
    blocked: "#e0243f",
    added: "#12a150",
    deleted: "#d93a4f",
    ping: "#16233a",
    agentColors: ["#1f5fd6", "#0b8f7a", "#6d38d6", "#c2185b", "#b45309", "#2e7d32"],
    locked: "#f3c0c6",
    scope: "#c7ead8",
    warn: "#e0a800",
    live: "#2f9e44",
    offline: "#9aa7b8",
    text: "#16233a",
    muted: "#5b6b84",
    panelBg: "rgba(255, 255, 255, 0.92)",
    panelBorder: "#cdd9ea",
    hemiSky: "#ffffff",
    hemiGround: "#9fb3cc",
    hemiIntensity: 1.4,
    keyLight: "#ffffff",
    keyIntensity: 1.6,
    labelTopBg: "rgba(31, 95, 214, 0.12)",
    labelTopBorder: "rgba(31, 95, 214, 0.45)",
    labelTopText: "#16233a",
  },
};

export const theme = { ...themes.night };

/** Swap the live palette. Callers remount the 3D scene so materials pick it up. */
export function applyTheme(name) {
  Object.assign(theme, themes[name] ?? themes.night);
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
