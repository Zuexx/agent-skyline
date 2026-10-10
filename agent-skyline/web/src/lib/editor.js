// Links that open a repo file in the editor. VS Code registers the vscode:// scheme, so a plain
// link works from the browser with no server help: vscode://file/<absolute path>:<line>.

/** vscode://file URL for `relPath` inside the repo at `repoPath` (absolute, "/"-separated). */
export function vscodeUrl(repoPath, relPath, line = 1) {
  if (!repoPath || !relPath) return null;
  const abs = `${repoPath.replace(/\/+$/, "")}/${relPath}`;
  // encodeURI keeps "/" and ":" (drive letters) but leaves "#" and "?" alone, which would cut the URL.
  const encoded = encodeURI(abs).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return `vscode://file/${encoded.replace(/^\/+/, "")}:${line}`;
}
