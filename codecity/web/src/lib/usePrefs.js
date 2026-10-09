import { useEffect, useState } from "react";
import { browserLocale } from "./i18n.js";

const KEY = "codecity.prefs";

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { theme: p.theme ?? "auto", locale: p.locale ?? browserLocale(), notify: p.notify === true };
  } catch {
    return { theme: "auto", locale: browserLocale(), notify: false };
  }
}

function systemTheme() {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
  } catch {
    return "night";
  }
}

/**
 * Per-viewer preferences (theme: auto | night | day, locale), remembered in localStorage.
 * `resolvedTheme` turns "auto" into night/day from the OS setting and follows its changes.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState(load);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // private mode or blocked storage: preferences just do not persist
    }
  }, [prefs]);

  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      return undefined;
    }
    const onChange = () => setSystem(systemTheme());
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const resolvedTheme = prefs.theme === "auto" ? system : prefs.theme;
  return {
    prefs,
    resolvedTheme,
    setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
    setLocale: (locale) => setPrefs((p) => ({ ...p, locale })),
    setNotify: (notify) => setPrefs((p) => ({ ...p, notify })),
  };
}
