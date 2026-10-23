// PROTOTYPE (step 6B): placeholder art drawn in code, so the two building looks can be compared for
// structure and frame rate before real art exists. Replaced by a pack's atlas.png in step 6C.
// One 128 x 128 cell per (kind, tier): kinds across, tiers down.

import * as THREE from "three";
import { KINDS } from "../lib/fileKind.js";

const CELL = 128;
const INK = "#3a2a1e";
const STYLE = {
  code: { wall: "#e9c99a", roof: "#d9783c", shape: "workshop" },
  test: { wall: "#c9c4b8", roof: "#7a8fa8", shape: "tower" },
  docs: { wall: "#efe3c8", roof: "#4f8fc9", shape: "dome" },
  config: { wall: "#f4f1ea", roof: "#b8b2a6", shape: "spire" },
  other: { wall: "#f3e6cf", roof: "#d2483c", shape: "mushroom" },
};

function stroke(ctx, w = 3) {
  ctx.lineWidth = w;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function windowAt(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#8fd3ff";
  ctx.fill();
  stroke(ctx, 2);
}

// A whole house, front view, standing on the cell's bottom edge (billboard look).
function drawHouse(ctx, x0, y0, kind, tier) {
  const s = STYLE[kind];
  const h = [70, 92, 118][tier];
  const w = [70, 80, 92][tier];
  const cx = x0 + CELL / 2;
  const bottom = y0 + CELL - 2;
  const bodyH = s.shape === "tower" || s.shape === "spire" ? h * 0.62 : h * 0.5;
  const bodyW = s.shape === "tower" || s.shape === "spire" ? w * 0.55 : w * 0.8;
  ctx.beginPath();
  ctx.rect(cx - bodyW / 2, bottom - bodyH, bodyW, bodyH);
  ctx.fillStyle = s.wall;
  ctx.fill();
  stroke(ctx);
  // door
  ctx.beginPath();
  ctx.rect(cx - 7, bottom - 18, 14, 18);
  ctx.fillStyle = "#8a5a34";
  ctx.fill();
  stroke(ctx, 2);
  const top = bottom - bodyH;
  ctx.beginPath();
  if (s.shape === "workshop") {
    ctx.moveTo(cx - bodyW / 2 - 6, top);
    ctx.lineTo(cx, top - (h - bodyH));
    ctx.lineTo(cx + bodyW / 2 + 6, top);
  } else if (s.shape === "tower" || s.shape === "spire") {
    ctx.moveTo(cx - bodyW / 2 - 5, top);
    ctx.lineTo(cx, top - (h - bodyH) - (s.shape === "spire" ? 6 : 0));
    ctx.lineTo(cx + bodyW / 2 + 5, top);
  } else if (s.shape === "dome") {
    ctx.ellipse(cx, top, bodyW / 2 + 4, h - bodyH, 0, Math.PI, 0);
  } else {
    ctx.ellipse(cx, top + 4, w / 2 + 6, h - bodyH + 4, 0, Math.PI, 0);
  }
  ctx.closePath();
  ctx.fillStyle = s.roof;
  ctx.fill();
  stroke(ctx);
  if (s.shape === "mushroom") {
    ctx.fillStyle = "#fff6e6";
    for (const [dx, dy] of [[-0.25, -0.4], [0.2, -0.55], [0.05, -0.2], [-0.05, -0.75]]) {
      ctx.beginPath();
      ctx.arc(cx + dx * w, top + dy * (h - bodyH), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s.shape === "workshop") {
    ctx.beginPath();
    ctx.rect(cx + bodyW / 4, top - (h - bodyH) * 0.8, 10, (h - bodyH) * 0.6);
    ctx.fillStyle = "#6d6a66";
    ctx.fill();
    stroke(ctx, 2);
  }
  windowAt(ctx, cx - bodyW / 4, bottom - bodyH * 0.65, 5);
  windowAt(ctx, cx + bodyW / 4, bottom - bodyH * 0.65, 5);
}

// Facade (left half) and roof (right half) textures for the low-poly model look.
function drawSkins(ctx, x0, y0, kind) {
  const s = STYLE[kind];
  const half = CELL / 2;
  ctx.fillStyle = s.wall;
  ctx.fillRect(x0, y0, half, CELL);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 + 1, half - 2, CELL - 2);
  for (let r = 0; r < 3; r++) windowAt(ctx, x0 + half / 2, y0 + 22 + r * 38, 7);
  ctx.fillStyle = s.roof;
  ctx.fillRect(x0 + half, y0, half, CELL);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  for (let y = 8; y < CELL; y += 10) {
    ctx.beginPath();
    ctx.moveTo(x0 + half, y0 + y);
    ctx.lineTo(x0 + CELL, y0 + y);
    ctx.stroke();
  }
}

/**
 * { texture, rect(kind, tier) -> [u, v, w, h] } for "billboard" or "model". Cells are inset by a
 * pixel so neighbours never bleed in.
 */
export function placeholderAtlas(style) {
  const canvas = document.createElement("canvas");
  canvas.width = KINDS.length * CELL;
  canvas.height = 3 * CELL;
  const ctx = canvas.getContext("2d");
  KINDS.forEach((kind, col) => {
    for (let tier = 0; tier < 3; tier++) {
      if (style === "billboard") drawHouse(ctx, col * CELL, tier * CELL, kind, tier);
      else drawSkins(ctx, col * CELL, tier * CELL, kind);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const W = canvas.width;
  const H = canvas.height;
  const rect = (kind, tier) => {
    const col = Math.max(0, KINDS.indexOf(kind));
    return [(col * CELL + 1) / W, 1 - ((tier + 1) * CELL - 1) / H, (CELL - 2) / W, (CELL - 2) / H];
  };
  return { texture, rect };
}
