// How buildings look in a sprite theme (specs/06-themes.md, step 6B). A "look" hands Buildings.jsx
// the geometry and material for its one InstancedMesh, where each building goes, and which atlas
// cell it shows. Two looks, to choose by measurement:
// - "model": a low-poly house (box body + four-sided roof) skinned from the atlas; turns with the
//   camera like any 3D object.
// - "billboard": a drawn house standing upright, turned to face the camera, lit through its normal
//   map and casting a shadow (the HD-2D way). Flat when seen from the side, so the camera only
//   turns in 90° steps.
// With a pack atlas (lib/spriteAtlas.js) billboards use the pack's pixel art; without one, both
// looks use placeholder art drawn in code (city/protoAtlas.js).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildingKind, KINDS, sizeTier, tierCuts } from "../lib/fileKind.js";
import { placeholderAtlas } from "./protoAtlas.js";

// The camera's pitch (the iso diagonal, 35.26°). Sprites are drawn for it: an upright panel is
// stretched by 1 / cos(pitch) so each texel still comes out square on screen.
const PITCH_STRETCH = 1 / Math.cos(Math.asin(1 / Math.sqrt(3)));

// Per-instance atlas cell: the vertex shader maps the mesh's 0..1 UVs into it, for every map the
// material uses (albedo, normal, emission, and the alpha used for shadows).
function withAtlasRect(material) {
  material.onBeforeCompile = (shader) => {
    const varyings = { MAP: "vMapUv", NORMALMAP: "vNormalMapUv", EMISSIVEMAP: "vEmissiveMapUv", ALPHAMAP: "vAlphaMapUv" };
    const remap = Object.entries(varyings)
      .map(([define, v]) => `#ifdef USE_${define}\n  ${v} = aRect.xy + ${v} * aRect.zw;\n#endif`)
      .join("\n");
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aRect;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>\n${remap}`);
  };
  material.customProgramCacheKey = () => "atlas-rect";
  return material;
}

function houseGeometry() {
  const body = new THREE.BoxGeometry(1, 1, 1);
  const uv = body.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5); // facade: left half of the cell
  const roof = new THREE.ConeGeometry(0.78, 0.55, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.5 + 0.275, 0);
  const ruv = roof.getAttribute("uv");
  for (let i = 0; i < ruv.count; i++) ruv.setX(i, 0.5 + ruv.getX(i) * 0.5); // roof: right half
  const merged = mergeGeometries([body.toNonIndexed(), roof.toNonIndexed()]);
  body.dispose();
  roof.dispose();
  return merged;
}

const MODEL_HEIGHT = [0.8, 1.4, 2.2];
const PLACEHOLDER_SIZE = [[1.3, 1.3], [1.45, 1.6], [1.6, 2.05]]; // [width, height] per tier

// Stable small number from a path, to pick among a tier's sprite variants.
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The look for `style` over `buildings`. `atlas` (lib/spriteAtlas.js) and `spec` (the pack's
 * `buildings` block: { pixelsPerUnit, kinds: { [kind]: [[names] per tier] } }) give real art;
 * `night` turns window glow up. Returns { geometry, material, depthMaterial, transform(b, base),
 * rects, billboard, lit, dispose() }; `rects` is one [u, v, w, h] per building, in building order.
 */
export function makeLook(style, buildings, { atlas = null, spec = null, night = false } = {}) {
  const billboard = style === "billboard";
  const real = billboard && atlas && spec?.kinds;
  const placeholder = real ? null : placeholderAtlas(billboard ? "billboard" : "model");
  const cuts = tierCuts(buildings.map((b) => b.lines));
  const ppu = spec?.pixelsPerUnit ?? 100;

  // Per building: atlas cell and world size.
  const cellOf = (b, tier) => {
    if (!real) return null;
    const kind = buildingKind(b.path);
    const tiers = spec.kinds[kind] ?? spec.kinds.other ?? spec.kinds[KINDS[0]];
    const names = (tiers?.[tier] ?? tiers?.[tiers.length - 1] ?? []).filter((n) => atlas.cells.has(n));
    return names.length ? atlas.cells.get(names[hash(b.path) % names.length]) : null;
  };
  const sizes = new Map();
  const rects = buildings.map((b) => {
    const tier = sizeTier(b.lines, cuts);
    const cell = cellOf(b, tier);
    if (cell) {
      sizes.set(b.path, [cell.w / ppu, (cell.h / ppu) * PITCH_STRETCH, tier]);
      return cell.uv;
    }
    sizes.set(b.path, [...(billboard ? PLACEHOLDER_SIZE[tier] : [0.9, MODEL_HEIGHT[tier]]), tier]);
    return placeholder ? placeholder.rect(buildingKind(b.path), tier) : [0, 0, 0, 0];
  });

  const geometry = billboard ? new THREE.PlaneGeometry(1, 1) : houseGeometry();
  let material;
  let depthMaterial = null;
  if (real) {
    material = new THREE.MeshStandardMaterial({
      map: atlas.albedo,
      normalMap: atlas.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      emissiveMap: atlas.emissive,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: night ? 2.2 : 0.8,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    });
    // Shadows follow the sprite's outline, not its rectangle.
    depthMaterial = withAtlasRect(new THREE.MeshDepthMaterial({ map: atlas.albedo, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }));
  } else if (billboard) {
    material = new THREE.MeshBasicMaterial({ map: placeholder.texture, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
  } else {
    material = new THREE.MeshLambertMaterial({ map: placeholder.texture, toneMapped: false });
  }
  withAtlasRect(material);

  // `base`: the district slab's top. Model height counts the body only; the roof sits on top.
  const transform = (b, base) => {
    const [w, h] = sizes.get(b.path) ?? [1, 1];
    return { position: [b.x + 0.5, base + h / 2, b.z + 0.5], scale: billboard ? [w, h, 1] : [w, h, w] };
  };
  return {
    geometry,
    material,
    depthMaterial,
    transform,
    rects,
    billboard,
    lit: Boolean(real),
    dispose() {
      geometry.dispose();
      material.dispose();
      depthMaterial?.dispose();
      placeholder?.texture.dispose();
    },
  };
}
