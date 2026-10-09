import { districtColor, theme } from "../theme.js";
import { districtGlob } from "../lib/zones.js";

// Flat slabs, one per district. A district at depth `d` sits on base = d * 0.1
// so nested districts stack on top of their parent; color darkens with depth.
// Locked districts are drawn in the locked color. In zone mode a click toggles the lock of the
// clicked (topmost, i.e. deepest) district.
export default function Districts({ districts, locked = [], zoneMode = false, onToggle }) {
  return (
    <group>
      {(districts ?? []).map((d) => {
        const isLocked = locked.includes(districtGlob(d.path));
        return (
          <mesh
            key={d.path}
            position={[d.x + d.w / 2, d.depth * 0.1 + 0.05, d.z + d.d / 2]}
            onClick={
              zoneMode && d.path
                ? (e) => {
                    e.stopPropagation(); // nested slabs overlap; only the topmost one toggles
                    onToggle?.(d.path);
                  }
                : undefined
            }
          >
            <boxGeometry args={[d.w, 0.1, d.d]} />
            <meshLambertMaterial color={isLocked ? theme.locked : districtColor(d.depth)} />
          </mesh>
        );
      })}
    </group>
  );
}
