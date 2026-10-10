// Picking buildings with a screen rectangle, and turning the picked files into a task for an agent.

/** Normalized rectangle from two corners: { left, top, right, bottom }. */
export function rectFrom(a, b) {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/** Paths whose screen point (from `screenOf(path)`, null when off screen) falls inside `rect`. */
export function pathsInRect(paths, screenOf, rect) {
  const out = [];
  for (const p of paths) {
    const s = screenOf(p);
    if (s && s.x >= rect.left && s.x <= rect.right && s.y >= rect.top && s.y <= rect.bottom) out.push(p);
  }
  return out;
}

/** Add `paths` to the selection, or, when every one of them is already in it, remove them. */
export function toggleAll(selection, paths) {
  const next = new Set(selection);
  const allIn = paths.length > 0 && paths.every((p) => next.has(p));
  for (const p of paths) allIn ? next.delete(p) : next.add(p);
  return next;
}

const TEMPLATE = {
  "zh-TW": {
    scope: "範圍:只修改下列檔案(其他檔案可以讀,但不要改;真的需要改範圍外的檔案時,先停下來問我):",
    noTask: "(在這裡寫任務)",
  },
  en: {
    scope: "Scope: change only these files (reading others is fine; if a file outside this list really needs changing, stop and ask me first):",
    noTask: "(describe the task here)",
  },
};

/** The text to paste into Claude Code (or any agent): the task, then the file list as its scope. */
export function taskPrompt(task, paths, locale = "en") {
  const tpl = TEMPLATE[locale] ?? TEMPLATE.en;
  const body = String(task ?? "").trim() || tpl.noTask;
  return `${body}\n\n${tpl.scope}\n${[...paths].sort().map((p) => `- ${p}`).join("\n")}\n`;
}
