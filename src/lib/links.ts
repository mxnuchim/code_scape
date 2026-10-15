/**
 * Where to send someone who wants to read the real source: GitHub for GitHub
 * cities, their editor for local ones.
 */
import type { RepoModel } from "./analysis/types";
import { githubBlobUrl, githubTreeUrl } from "./github/client";

export interface SourceLink {
  href: string;
  label: string;
  external: boolean;
}

/** Editors that register a URL scheme for opening files at a line. */
export const EDITORS = {
  vscode: { label: "VS Code", url: (abs: string, line?: number) => `vscode://file${encodeURI(abs)}${line ? `:${line}` : ""}` },
  cursor: { label: "Cursor", url: (abs: string, line?: number) => `cursor://file${encodeURI(abs)}${line ? `:${line}` : ""}` },
  idea: { label: "JetBrains", url: (abs: string, line?: number) => `idea://open?file=${encodeURIComponent(abs)}${line ? `&line=${line}` : ""}` },
} as const;

export type EditorId = keyof typeof EDITORS;

export function sourceLink(model: RepoModel, path: string, opts: { line?: number; endLine?: number; dir?: boolean; editor?: EditorId } = {}): SourceLink | null {
  if (model.origin.kind === "local") {
    const editor = EDITORS[opts.editor ?? "vscode"];
    const abs = `${model.origin.root}/${path}`.replace(/\/+$/, "");
    return { href: editor.url(abs, opts.dir ? undefined : opts.line), label: `Open in ${editor.label}`, external: false };
  }
  if (!model.meta.htmlUrl) return null;
  if (opts.dir) return { href: githubTreeUrl(model.meta, model.ref, path), label: "Open on GitHub", external: true };
  const anchor = opts.line ? `#L${opts.line}${opts.endLine && opts.endLine !== opts.line ? `-L${opts.endLine}` : ""}` : "";
  return { href: `${githubBlobUrl(model.meta, model.ref, path)}${anchor}`, label: "Open on GitHub", external: true };
}
