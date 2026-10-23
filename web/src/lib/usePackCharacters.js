import { useEffect, useState } from "react";
import * as THREE from "three";

// One texture per frame: a few small images per character, so no atlas is needed.
function loadTexture(url, color) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        resolve(t);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/**
 * The pack's characters (specs/06-themes.md `characters`): [{ id, frames: { [pose]: { map, normal,
 * w, h } } }], or null while loading and when the pack has none. Poses are idle, walk and work; a
 * character missing one falls back to idle. Textures are released when the pack changes.
 */
export function usePackCharacters(pack) {
  const [chars, setChars] = useState(null);
  const list = pack?.characters ?? null;
  useEffect(() => {
    if (!Array.isArray(list) || !list.length) {
      setChars(null);
      return undefined;
    }
    let cancelled = false;
    const all = [];
    const base = `/themes/${encodeURIComponent(pack.id)}/`;
    Promise.all(
      list.map(async (c) => {
        const frames = {};
        for (const [pose, f] of Object.entries(c.frames ?? {})) {
          const [map, normal] = await Promise.all([loadTexture(base + f.albedo, true), f.normal ? loadTexture(base + f.normal, false) : null]);
          if (!map) continue;
          all.push(map, normal);
          frames[pose] = { map, normal, w: map.image.width, h: map.image.height };
        }
        return { id: c.id, frames };
      })
    ).then((loaded) => {
      if (cancelled) all.forEach((t) => t?.dispose());
      else setChars(loaded.filter((c) => c.frames.idle));
    });
    return () => {
      cancelled = true;
      all.forEach((t) => t?.dispose());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack?.id, list]);
  return chars;
}
