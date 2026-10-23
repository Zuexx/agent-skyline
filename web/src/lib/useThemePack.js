import { useEffect, useState } from "react";
import { builtinPack } from "../theme.js";
import { validatePack } from "./themePack.js";

/**
 * The theme pack `id`, loaded from /themes/<id>/theme.json. Until it arrives, and whenever it is
 * missing or broken, the built-in `blocks` pack is used and `error` says why.
 * Returns { pack, error }.
 */
export function useThemePack(id) {
  const [state, setState] = useState({ pack: builtinPack, error: null });
  useEffect(() => {
    let cancelled = false;
    fetch(`/themes/${encodeURIComponent(id)}/theme.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => {
        const { ok, pack, errors } = validatePack(json, id, builtinPack);
        if (!cancelled) setState(ok ? { pack, error: null } : { pack: builtinPack, error: errors.join("; ") });
      })
      .catch((err) => !cancelled && setState({ pack: builtinPack, error: id === builtinPack.id ? null : err.message }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return state;
}

/** The packs the server knows (/api/themes), for the theme menu; [] until loaded. */
export function useThemeList() {
  const [list, setList] = useState([]);
  useEffect(() => {
    fetch("/api/themes")
      .then((res) => (res.ok ? res.json() : []))
      .then((l) => Array.isArray(l) && setList(l))
      .catch(() => {});
  }, []);
  return list;
}
