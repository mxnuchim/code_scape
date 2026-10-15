/**
 * Turn what a model passes in (a path, a symbol id, or a bare symbol name)
 * into one concrete target, or explain why it can't.
 */
import { normalizeRepoPath, PathAccessError } from "../lib/local/safety";
import { indexLookup, searchSymbols } from "../lib/analysis/code/queries";
import type { CodeSymbol } from "../lib/analysis/code/types";
import type { WorkspaceState } from "./context";

export type Target =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string }
  | { kind: "symbol"; path: string; symbol: CodeSymbol };

export class TargetError extends Error {
  constructor(
    message: string,
    readonly candidates: string[] = [],
  ) {
    super(message);
    this.name = "TargetError";
  }
}

export function resolveTarget(state: WorkspaceState, raw: string): Target {
  const input = raw.trim();
  const { model, analysis } = state;
  const lookup = indexLookup(analysis.index);

  // A symbol id: "path#Name" (path part must be safe).
  if (input.includes("#")) {
    const sym = lookup.symbols.get(input);
    if (sym) return { kind: "symbol", path: sym.path, symbol: sym };
    const [p] = input.split("#");
    normalizeRepoPath(p);
  }

  let path: string | null = null;
  try {
    path = normalizeRepoPath(input);
  } catch (err) {
    if (!(err instanceof PathAccessError) || /[/.]/.test(input)) throw err;
  }
  if (path !== null) {
    if (model.filesByPath.has(path)) return { kind: "file", path };
    if (model.dirsByPath.has(path)) return { kind: "directory", path };
  }

  // A symbol name or qualified name.
  const hits = searchSymbols(analysis.index, input, 8).filter((h) => h.score >= 800 || h.symbol.qualifiedName === input || h.symbol.name === input);
  const exact = hits.filter((h) => h.symbol.qualifiedName === input || h.symbol.name === input);
  if (exact.length === 1) return { kind: "symbol", path: exact[0].symbol.path, symbol: exact[0].symbol };
  if (exact.length > 1) {
    throw new TargetError(`"${input}" matches several declarations. Pass one of these symbol ids instead.`, exact.map((h) => h.symbol.id));
  }
  const suggestions = searchSymbols(analysis.index, input, 5).map((h) => h.symbol.id);
  throw new TargetError(
    `No file, folder or declaration named "${input}" in the analysed files.${suggestions.length ? " Did you mean one of the listed symbol ids?" : " Use find_code to search."}`,
    suggestions,
  );
}

export function targetErrorText(err: TargetError): string {
  return err.candidates.length ? `${err.message}\n${err.candidates.map((c) => `- ${c}`).join("\n")}` : err.message;
}
