import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, TiltShift, Vignette } from "@react-three/postprocessing";
import { theme } from "../theme.js";
import { createQualityGovernor } from "../lib/quality.js";

// Post-processing for the scene. `post` is the theme pack's post block (specs/06-themes.md):
// { quality, tiltShift: { focusArea, feather }, bloom: { threshold, intensity } }. Without one (the
// Blocks pack) it is what it always was: bloom at night, nothing by day. With one, the level starts
// at post.quality and steps down while frames are slow (lib/quality.js); `onLevel` hears about it.
export default function PostFx({ post = null, onLevel = null }) {
  const governor = useMemo(() => (post ? createQualityGovernor(post.quality) : null), [post]);
  const [level, setLevel] = useState(() => governor?.level ?? null);
  // The level in effect, readable from outside (bench/perf.mjs reports it).
  useEffect(() => {
    document.documentElement.dataset.postLevel = level ?? (theme.bloom ? "bloom" : "none");
  }, [level]);
  useFrame((_, delta) => {
    if (governor?.frame(delta * 1000)) {
      setLevel(governor.level);
      onLevel?.(governor.level);
    }
  });

  if (!post) {
    // Night only: colors pushed above 1.0 (active buildings, pulses, agents) cross the threshold.
    if (!theme.bloom) return null;
    return (
      <EffectComposer>
        <Bloom mipmapBlur intensity={1.4} luminanceThreshold={1} luminanceSmoothing={0.2} />
      </EffectComposer>
    );
  }
  if (level === "low") return null;
  const bloom = <Bloom mipmapBlur intensity={post.bloom?.intensity ?? 0.8} luminanceThreshold={post.bloom?.threshold ?? 0.8} luminanceSmoothing={0.2} />;
  if (level === "medium") return <EffectComposer>{bloom}</EffectComposer>;
  return (
    <EffectComposer>
      {/* HD-2D's miniature look: sharp band across the middle, soft top and bottom. */}
      <TiltShift focusArea={post.tiltShift?.focusArea ?? 0.4} feather={post.tiltShift?.feather ?? 0.3} />
      {bloom}
      <Vignette offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
}
