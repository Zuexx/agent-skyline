// How buildings look in a sprite theme (specs/06-themes.md, step 6B). A "look" hands Buildings.jsx
// the geometry and material for its one InstancedMesh, where each building goes, and which atlas
// cell it shows. Two looks are prototyped side by side, to choose by measurement:
// - "model": a low-poly house (box body + four-sided roof) skinned from the atlas; turns with the
//   camera like any 3D object.
// - "billboard": a drawn house standing upright, turned to face the camera; closest to the concept
//   art, flat when seen from the side, so the camera only turns in 90° steps.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildingKind, sizeTier, tierCuts } from "../lib/fileKind.js";
import { placeholderAtlas } from "./protoAtlas.js";

// Per-instance atlas cell: the vertex shader maps the mesh's 0..1 UVs into it.
function withAtlasRect(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aRect;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = aRect.xy + vMapUv * aRect.zw;\n#endif");
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

function billboardGeometry() {
  return new THREE.PlaneGeometry(1, 1); // centered; Buildings places its middle at half height
}

const MODEL_HEIGHT = [0.8, 1.4, 2.2];
const BILLBOARD_SIZE = [[1.3, 1.3], [1.45, 1.6], [1.6, 2.05]]; // [width, height] per tier

/**
 * The look for `style` over `buildings`. Returns { geometry, material, transform(b, base), rects,
 * billboard, dispose() }; `rects` is one [u, v, w, h] per building, in building order.
 */
export function makeLook(style, buildings) {
  const billboard = style === "billboard";
  const atlas = placeholderAtlas(billboard ? "billboard" : "model");
  const cuts = tierCuts(buildings.map((b) => b.lines));
  const tiers = buildings.map((b) => sizeTier(b.lines, cuts));
  const rects = buildings.map((b, i) => atlas.rect(buildingKind(b.path), tiers[i]));
  const tierByPath = new Map(buildings.map((b, i) => [b.path, tiers[i]]));
  const geometry = billboard ? billboardGeometry() : houseGeometry();
  const material = withAtlasRect(
    billboard
      ? new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false })
      : new THREE.MeshLambertMaterial({ map: atlas.texture, toneMapped: false })
  );
  // `base`: the district slab's top. Model height counts the body only; the roof sits on top.
  const transform = (b, base) => {
    const tier = tierByPath.get(b.path) ?? 0;
    if (billboard) {
      const [w, h] = BILLBOARD_SIZE[tier];
      return { position: [b.x + 0.5, base + h / 2, b.z + 0.5], scale: [w, h, 1] };
    }
    const h = MODEL_HEIGHT[tier];
    return { position: [b.x + 0.5, base + h / 2, b.z + 0.5], scale: [0.9, h, 0.9] };
  };
  return {
    geometry,
    material,
    transform,
    rects,
    billboard,
    dispose() {
      geometry.dispose();
      material.dispose();
      atlas.texture.dispose();
    },
  };
}
