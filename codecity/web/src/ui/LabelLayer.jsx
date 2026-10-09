import { useEffect, useState } from "react";
import { theme } from "../theme.js";
import { t } from "../lib/i18n.js";

// The DOM side of the district signs (see city/DistrictLabels.jsx): renders the signs the scene
// asks for and hands their elements back through `bus`; the scene positions them every frame.
// In grouped views the top-level districts are group ids (`code`, `added`...), shown translated.
export default function LabelLayer({ bus, grouped = false }) {
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    bus.setLabels = setLabels;
    return () => {
      bus.setLabels = null;
    };
  }, [bus]);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10, overflow: "hidden" }}>
      {labels.map((l) => {
        const top = l.depth === 1;
        const raw = l.path.slice(l.path.lastIndexOf("/") + 1);
        const name = grouped && top ? t(`group.${raw}`) : raw;
        return (
          <div
            key={l.key}
            ref={(el) => (el ? bus.elements.set(l.key, el) : bus.elements.delete(l.key))}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              display: "none", // until the scene has placed it
              zIndex: top ? 2 : 1,
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
            {l.count != null && <span style={{ fontWeight: 400, color: theme.muted, marginLeft: 6, fontSize: top ? 12 : 10 }}>{l.count}</span>}
          </div>
        );
      })}
    </div>
  );
}
