import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../server/layout.mjs";

const FILES = [
  { path: "README.md", lines: 40 },
  { path: ".gitignore", lines: 5 },
  { path: "api/Anvil/Data/UnitOfWork.cs", lines: 110 },
  { path: "api/Anvil/Core/App.cs", lines: 30 },
  { path: "api/Anvil/readme.md", lines: 8 },
  { path: "api/ForgeKit.Api/Program.cs", lines: 25 },
  { path: "app/src/main.tsx", lines: 60 },
  { path: "app/package.json", lines: 30 },
];

// A wider, deeper tree to exercise shelf wrapping at several levels.
const STRESS = [];
for (let i = 0; i < 6; i++) {
  for (let j = 0; j < 5; j++) {
    STRESS.push({ path: `d${i}/sub${j % 3}/f${j}.txt`, lines: j * 17 + i });
  }
}

const asMap = (list) => new Map(list.map((b) => [b.path, b]));

function assertNoOverlap(buildings) {
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i];
      const b = buildings[j];
      // 1x1 footprints: touching edges is fine, interiors must not intersect.
      assert.ok(
        Math.abs(a.x - b.x) >= 1 || Math.abs(a.z - b.z) >= 1,
        `overlap: ${a.path} (${a.x},${a.z}) and ${b.path} (${b.x},${b.z})`,
      );
    }
  }
}

function assertEveryFileOnce(files, buildings) {
  assert.deepEqual(
    [...buildings.map((b) => b.path)].sort(),
    [...files.map((f) => f.path)].sort(),
  );
}

function assertInsideDistricts(districts, buildings) {
  const byPath = new Map(districts.map((d) => [d.path, d]));
  for (const b of buildings) {
    const slash = b.path.lastIndexOf("/");
    const dirPath = slash === -1 ? "" : b.path.slice(0, slash);
    const d = byPath.get(dirPath);
    assert.ok(d, `no district for ${dirPath}`);
    assert.ok(
      b.x >= d.x && b.z >= d.z && b.x + 1 <= d.x + d.w && b.z + 1 <= d.z + d.d,
      `${b.path} at (${b.x},${b.z}) outside district ${d.path} (${d.x},${d.z},${d.w},${d.d})`,
    );
  }
}

test("layout returns the root district at the origin with width/depth", () => {
  const r = layout(FILES);
  assert.ok(r.width > 0 && r.depth > 0);
  const root = r.districts.find((d) => d.path === "");
  assert.ok(root, "root district must be present");
  assert.equal(root.depth, 0);
  assert.equal(root.x, 0);
  assert.equal(root.z, 0);
  assert.equal(root.w, r.width);
  assert.equal(root.d, r.depth);

  const anvil = r.districts.find((d) => d.path === "api/Anvil");
  assert.ok(anvil, "nested district must be present");
  assert.equal(anvil.depth, 2);
});

test("no two buildings overlap and every file appears exactly once", () => {
  for (const files of [FILES, STRESS]) {
    const r = layout(files);
    assertNoOverlap(r.buildings);
    assertEveryFileOnce(files, r.buildings);
    assertInsideDistricts(r.districts, r.buildings);
  }
});

test("the same input twice gives an identical output", () => {
  const a = layout(FILES);
  const b = layout(FILES);
  assert.deepStrictEqual(a, b);
});

test("changing only lines changes heights but not positions or sizes", () => {
  const changed = FILES.map((f) => ({ ...f, lines: f.lines * 3 + 1 }));
  const a = layout(FILES);
  const b = layout(changed);

  assert.equal(b.width, a.width);
  assert.equal(b.depth, a.depth);
  assert.deepStrictEqual(a.districts, b.districts);

  const bm = asMap(b.buildings);
  for (const fa of a.buildings) {
    const fb = bm.get(fa.path);
    assert.ok(fb, `missing building ${fa.path}`);
    assert.equal(fb.x, fa.x);
    assert.equal(fb.z, fa.z);
  }
  assert.notDeepStrictEqual(
    a.buildings.map((x) => x.height),
    b.buildings.map((x) => x.height),
    "heights must change when lines change",
  );
});

test("height is max(0.3, log10(lines + 1)) and coordinates are finite numbers", () => {
  const r = layout([...FILES, ...STRESS]);
  for (const b of r.buildings) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
    const expected = Math.max(0.3, Math.log10(b.lines + 1));
    assert.ok(Math.abs(b.height - expected) < 1e-9, `${b.path}: ${b.height} != ${expected}`);
  }
});
