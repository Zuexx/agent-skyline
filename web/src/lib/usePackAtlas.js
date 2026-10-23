import { useEffect, useState } from "react";
import { loadSpriteAtlas } from "./spriteAtlas.js";

/**
 * The pack's sprite atlas (lib/spriteAtlas.js) for the night or day variant, or null while it
 * loads, when the pack has no sprites, or when they fail to load (the look then falls back to
 * placeholder art). The previous atlas's textures are released when it is replaced.
 */
export function usePackAtlas(pack, night) {
  const [atlas, setAtlas] = useState(null);
  const sprites = pack?.sprites ?? null;
  useEffect(() => {
    if (!sprites) {
      setAtlas(null);
      return undefined;
    }
    let cancelled = false;
    let loaded = null;
    loadSpriteAtlas(`/themes/${encodeURIComponent(pack.id)}/`, sprites, { night })
      .then((a) => {
        if (cancelled) a.dispose();
        else {
          loaded = a;
          setAtlas(a);
        }
      })
      .catch((err) => {
        console.warn(`agent-skyline: theme ${pack.id}: ${err.message}`);
        if (!cancelled) setAtlas(null);
      });
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [pack?.id, sprites, night]);
  return atlas;
}
