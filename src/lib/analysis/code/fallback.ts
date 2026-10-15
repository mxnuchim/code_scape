/**
 * Regex fallback when tree-sitter isn't available (or for .vue/.svelte/.astro
 * files): imports with line numbers only. No symbols or calls are reported,
 * so nothing downstream can mistake a guess for a parse.
 */
import { findJsImports, findPythonImports } from "../imports/extract";
import type { CodeLanguage, ParsedFile } from "./types";

export function parseWithRegex(path: string, text: string, lang: CodeLanguage | undefined): ParsedFile {
  const language: CodeLanguage = lang ?? "js";
  const lineCount = text.length === 0 ? 0 : text.split("\n").length;
  const base: ParsedFile = { path, language, parser: "regex", lineCount, symbols: [], imports: [], calls: [], routes: [], exports: {} };
  if (language === "python") {
    base.imports = findPythonImports(text).map(({ line, level, module, names }) => ({
      specifier: `${".".repeat(level)}${module}`,
      line,
      kind: "static",
      typeOnly: false,
      bindings: [],
      python: { level, module, names },
    }));
  } else if (language === "js" || language === "ts" || language === "tsx") {
    base.imports = findJsImports(text).map(({ specifier, line }) => ({ specifier, line, kind: "static", typeOnly: false, bindings: [] }));
  }
  return base;
}
