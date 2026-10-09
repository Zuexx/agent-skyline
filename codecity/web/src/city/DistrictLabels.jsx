import { useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// Name signs on districts. Zoomed out, only the top level is labeled; zooming in reveals one more
// level at a time, so the city never turns into a wall of text. Each sign sits on the district's
// far corner (smallest x and z), which is its top tip in the isometric view.
const LEVEL_STEPS = [1, 1.8, 3.2, 5]; // zoom / fitZoom needed to show depth 1, 2, 3, 4

// In grouped views the top-level districts are group ids (`code`, `added`...), shown translated.
export default function DistrictLabels({ districts, fileCounts, grouped = false }) {
  const camera = useThree((s) => s.camera);
  const [maxDepth, setMaxDepth] = useState(1);
  const clock = useRef(0);

  useFrame((_, delta) => {
    clock.current += delta;
    if (clock.current < 0.2) return;
    clock.current = 0;
    const rel = camera.zoom / (camera.userData.fitZoom || camera.zoom);
    let d = 0;
    while (d < LEVEL_STEPS.length && rel >= LEVEL_STEPS[d] * 0.999) d++;
    if (d !== maxDepth) setMaxDepth(d);
  });

  const shown = useMemo(
    () => (districts ?? []).filter((d) => d.depth >= 1 && d.depth <= maxDepth && d.w > 0),
    [districts, maxDepth]
  );

  return (
    <group>
      {shown.map((d) => {
        const top = d.depth === 1;
        const raw = d.path.slice(d.path.lastIndexOf("/") + 1);
        const name = grouped && top ? t(`group.${raw}`) : raw;
        return (
          <Html
            key={d.path}
            position={[d.x + 0.6, d.depth * 0.1 + 0.15, d.z + 0.6]}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: "none", transform: "translate(-50%, -100%)" }}
          >
            <div
              style={{
                whiteSpace: "nowrap",
                fontFamily: "system-ui, sans-serif",
                fontSize: top ? 15 : 12,
                fontWeight: top ? 800 : 600,
                letterSpacing: top ? 0.4 : 0,
                color: top ? theme.labelTopText : theme.text,
                background: top ? theme.labelTopBg : theme.panelBg,
                border: `1px solid ${top ? theme.labelTopBorder : theme.panelBorder}`,
                borderRadius: 6,
                padding: top ? "3px 9px" : "1px 6px",
                textShadow: theme.bloom ? "0 1px 2px rgba(0,0,0,0.6)" : "none",
              }}
            >
              {name}
              {fileCounts?.get(d.path) != null && (
                <span style={{ fontWeight: 400, color: theme.muted, marginLeft: 6, fontSize: top ? 12 : 10 }}>
                  {fileCounts.get(d.path)}
                </span>
              )}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
