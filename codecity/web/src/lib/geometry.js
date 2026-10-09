import { parentDir } from "./parent.js";

// District slabs are 0.1 thick and stacked by depth, so a building inside a
// district of depth `d` sits on base = d * 0.1. Root files use depth 0.

/**
 * World transform for one building (before the city-wide centering offset).
 * Building footprint is 1x1 with top-left at (x, z); three.js boxes are
 * centered, so the instance goes to (x + 0.5, height/2 + base, z + 0.5)
 * scaled to (0.9, height, 0.9).
 */
export function buildingTransform(building, districtDepthByPath = {}, heightScale = 1) {
  // `dir` is the building's district in the current view (grouped views use virtual folders).
  const depth = districtDepthByPath[building.dir ?? parentDir(building.path)] ?? 0;
  const base = depth * 0.1;
  const height = building.height * heightScale;
  return {
    position: [building.x + 0.5, height / 2 + base, building.z + 0.5],
    scale: [0.9, height, 0.9],
  };
}

// The server's log10 heights top out around 4 while a mid-size repo is ~150 units wide, which
// reads as flat from the isometric camera. Exaggerate vertically so size differences show.
export const HEIGHT_SCALE = 2.5;

/**
 * City extent for camera fitting. The city is rendered centered on the origin
 * (raw coordinates minus width/2 and depth/2), so its world-space center is
 * [0, 0, 0] and it spans `size` in x and z.
 */
export function cityBounds(city) {
  const width = Number(city.width) || 0;
  const depth = Number(city.depth) || 0;
  return {
    center: [0, 0, 0],
    size: [width, 0, depth],
  };
}
