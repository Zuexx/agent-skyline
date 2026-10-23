// Packs a theme pack's sprite images into one atlas per map at load time (specs/06-themes.md):
// albedo, normal and emission share one layout, so a single per-instance cell indexes all three.
// A pack lists its sprites as { name: { albedo, normal?, emissive?, emissiveNight? } } (paths inside
// the pack); missing maps are filled flat (no bump, no glow).

import * as THREE from "three";

const PAD = 4; // transparent border around each sprite, so mipmaps do not bleed between cells
export const MAX_ATLAS = 2048;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

/**
 * Shelf packing, tallest first: [{ name, x, y, w, h }] and the atlas size (power of two), or null
 * when the sprites do not fit in MAX_ATLAS. Pure; exported for tests.
 */
export function packRects(sizes, max = MAX_ATLAS) {
  const items = [...sizes].sort((a, b) => b.h - a.h || b.w - a.w);
  for (let size = 256; size <= max; size *= 2) {
    const out = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    let fits = true;
    for (const it of items) {
      const w = it.w + PAD * 2;
      const h = it.h + PAD * 2;
      if (w > size) {
        fits = false;
        break;
      }
      if (x + w > size) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      if (y + h > size) {
        fits = false;
        break;
      }
      out.push({ name: it.name, x: x + PAD, y: y + PAD, w: it.w, h: it.h });
      x += w;
      shelf = Math.max(shelf, h);
    }
    if (fits) return { size, rects: out };
  }
  return null;
}

function canvasTexture(canvas, color) {
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; // crisp pixels up close
  t.minFilter = THREE.LinearMipmapLinearFilter; // no shimmer far away
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
}

/**
 * Load and pack `sprites` from the pack at `base` ("/themes/<id>/"). `night` picks the night
 * emission map where a sprite has one. Returns { size, cells: Map name -> { uv: [u, v, w, h], w, h },
 * albedo, normal, emissive, dispose() }.
 */
export async function loadSpriteAtlas(base, sprites, { night = false } = {}) {
  const names = Object.keys(sprites);
  const load = (p) => (p ? loadImage(base + p).catch(() => null) : Promise.resolve(null));
  const imgs = await Promise.all(
    names.map(async (name) => {
      const s = sprites[name];
      const [albedo, normal, emissive] = await Promise.all([load(s.albedo), load(s.normal), load(night ? s.emissiveNight ?? s.emissive : s.emissive)]);
      return { name, albedo, normal, emissive };
    })
  );
  const ok = imgs.filter((i) => i.albedo);
  const packed = packRects(ok.map((i) => ({ name: i.name, w: i.albedo.width, h: i.albedo.height })));
  if (!packed) throw new Error(`sprites do not fit in a ${MAX_ATLAS} x ${MAX_ATLAS} atlas`);
  const { size, rects } = packed;
  const layer = (fill) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, size, size);
    }
    return { c, ctx };
  };
  const A = layer(null);
  const N = layer("rgb(128,128,255)"); // flat normal
  const E = layer("#000");
  const byName = new Map(ok.map((i) => [i.name, i]));
  const cells = new Map();
  for (const r of rects) {
    const i = byName.get(r.name);
    A.ctx.drawImage(i.albedo, r.x, r.y);
    if (i.normal) N.ctx.drawImage(i.normal, r.x, r.y, r.w, r.h);
    if (i.emissive) E.ctx.drawImage(i.emissive, r.x, r.y, r.w, r.h);
    // UV origin is bottom-left (textures flip on upload).
    cells.set(r.name, { uv: [r.x / size, 1 - (r.y + r.h) / size, r.w / size, r.h / size], w: r.w, h: r.h });
  }
  const albedo = canvasTexture(A.c, true);
  const normal = canvasTexture(N.c, false);
  const emissive = canvasTexture(E.c, true);
  return {
    size,
    cells,
    albedo,
    normal,
    emissive,
    dispose() {
      albedo.dispose();
      normal.dispose();
      emissive.dispose();
    },
  };
}
