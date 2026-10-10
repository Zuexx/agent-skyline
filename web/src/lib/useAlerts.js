import { useEffect, useRef, useState } from "react";
import { freshAlerts } from "./alerts.js";

const TOAST_MS = 7000;
const MAX_TOASTS = 4;

/**
 * Announce fresh alerts: as in-page toasts (always) and as desktop notifications (when `notify`
 * is on and the browser granted permission). Returns { toasts, dismiss }.
 * `describe(alert)` -> { title, body } builds the notification text (already translated).
 */
export function useAlerts(alerts, { notify, describe, onClick }) {
  // Replayed history is old, so freshAlerts() lists it as seen without announcing it; only
  // alerts younger than FRESH_MS ring.
  const seen = useRef(new Set());
  const [toasts, setToasts] = useState([]);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const fresh = freshAlerts(alerts, seen.current, Date.now());
    if (!fresh.length) return;
    setToasts((t) => [...fresh, ...t].slice(0, MAX_TOASTS));
    for (const a of fresh) {
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== a.key)), TOAST_MS);
      if (notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const { title, body } = describe(a);
          const n = new Notification(title, { body, tag: a.key });
          n.onclick = () => {
            window.focus();
            onClickRef.current?.(a);
          };
        } catch {
          // some environments expose Notification but refuse to construct it
        }
      }
    }
  }, [alerts, notify, describe]);

  return { toasts, dismiss: (key) => setToasts((t) => t.filter((x) => x.key !== key)) };
}

/** Ask for permission (must run from a click). Resolves to true when notifications may be shown. */
export async function requestNotify() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
