// Pure layout: scanned files -> { districts, buildings, width, depth }.
// Positions depend only on paths and sibling names (never on line counts), so editing a
// file changes its height but never moves anything. Coordinates are absolute with the
// origin at the root district's top-left corner; x goes right, z goes down.

const CELL_PITCH = 1.5; // file cell pitch: 1 (footprint) + 0.5 gap
const SHELF_GAP = 1; // gap between items in a row and between rows
const DISTRICT_PAD = 1; // padding around a directory's content, on every side

export function layout(files) {
  const root = buildTree(files);
  const districts = [];
  const buildings = [];
  placeDir(root, "", 0, 0, districts, buildings);
  const r = districts[0]; // the root district is always placed first
  return { districts, buildings, width: r.w, depth: r.d };
}

function buildTree(files) {
  const root = { name: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = String(f.path).split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) {
        node.dirs.set(parts[i], { name: parts[i], dirs: new Map(), files: [] });
      }
      node = node.dirs.get(parts[i]);
    }
    node.files.push(f);
  }
  return root;
}

// The shelf-packing items of one directory, in placement order: subdirectories first
// (name ascending), then the file grid as a single rectangle.
function dirItems(node) {
  const subdirs = [...node.dirs.values()].sort((a, b) => cmp(a.name, b.name));
  const filesSorted = [...node.files].sort((a, b) => cmp(a.path, b.path));
  const items = subdirs.map((sd) => ({ kind: "dir", node: sd, ...measureDir(sd) }));
  if (filesSorted.length > 0) {
    const cols = Math.ceil(Math.sqrt(filesSorted.length));
    const rows = Math.ceil(filesSorted.length / cols);
    // Tight bounding box of cells at CELL_PITCH: c columns span c*1 + (c-1)*0.5.
    items.push({
      kind: "grid",
      files: filesSorted,
      cols,
      w: cols * CELL_PITCH - (CELL_PITCH - 1),
      d: rows * CELL_PITCH - (CELL_PITCH - 1),
    });
  }
  return items;
}

function measureDir(node) {
  const packed = shelf(dirItems(node));
  if (packed.contentW === 0 && packed.contentD === 0) return { w: 0, d: 0 }; // empty dir
  return { w: packed.contentW + 2 * DISTRICT_PAD, d: packed.contentD + 2 * DISTRICT_PAD };
}

// Shelf packing: left to right with SHELF_GAP between items; a new row starts when the
// next item would exceed maxRowWidth. Row height is the tallest item in the row.
function shelf(items) {
  if (items.length === 0) return { contentW: 0, contentD: 0, placed: [] };
  const widest = Math.max(...items.map((i) => i.w));
  const area = items.reduce((s, i) => s + i.w * i.d, 0);
  const maxRowWidth = Math.max(widest, Math.ceil(Math.sqrt(area)) * 1.3);

  const placed = [];
  let xPos = 0; // left edge of the next slot (includes the trailing gap after each item)
  let rowH = 0;
  let contentW = 0;
  let contentD = 0;
  for (const it of items) {
    if (xPos > 0 && xPos + it.w > maxRowWidth) {
      contentW = Math.max(contentW, xPos - SHELF_GAP);
      contentD += rowH + SHELF_GAP;
      xPos = 0;
      rowH = 0;
    }
    placed.push({ x: xPos, z: contentD });
    xPos += it.w + SHELF_GAP;
    rowH = Math.max(rowH, it.d);
  }
  contentW = Math.max(contentW, xPos - SHELF_GAP);
  contentD += rowH;
  return { contentW, contentD, placed };
}

function placeDir(node, dirPath, ox, oz, districts, buildings) {
  const items = dirItems(node);
  const packed = shelf(items);
  const empty = packed.contentW === 0 && packed.contentD === 0;
  const w = empty ? 0 : packed.contentW + 2 * DISTRICT_PAD;
  const d = empty ? 0 : packed.contentD + 2 * DISTRICT_PAD;
  districts.push({
    path: dirPath,
    depth: dirPath === "" ? 0 : dirPath.split("/").length,
    x: ox,
    z: oz,
    w,
    d,
  });

  items.forEach((item, i) => {
    const px = ox + DISTRICT_PAD + packed.placed[i].x;
    const pz = oz + DISTRICT_PAD + packed.placed[i].z;
    if (item.kind === "dir") {
      placeDir(
        item.node,
        dirPath === "" ? item.node.name : `${dirPath}/${item.node.name}`,
        px,
        pz,
        districts,
        buildings,
      );
    } else {
      for (let k = 0; k < item.files.length; k++) {
        const f = item.files[k];
        buildings.push({
          path: f.path,
          // Grouped views lay files out under a virtual path ("測試/api/x.cs"); `src` carries the
          // real path through so the UI can match buildings across views. Absent for the server's
          // own folder layout.
          ...(f.src ? { src: f.src } : {}),
          x: px + (k % item.cols) * CELL_PITCH,
          z: pz + Math.floor(k / item.cols) * CELL_PITCH,
          lines: f.lines,
          height: buildingHeight(f.lines),
        });
      }
    }
  });
}

function buildingHeight(lines) {
  return Math.max(0.3, Math.log10(lines + 1));
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0; // code-unit order: deterministic across platforms
}
