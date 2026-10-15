/**
 * Import extraction from source text. Comments are removed first, and string
 * contents are kept only where an import specifier can appear. That way an
 * import quoted in a comment or docstring is never counted as a dependency.
 */

export type ImportLanguage = "js" | "python";

export function importLanguageFor(path: string): ImportLanguage | undefined {
  const lower = path.toLowerCase();
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|astro)$/.test(lower) && !lower.endsWith(".d.ts")) return "js";
  if (/\.(py|pyi)$/.test(lower)) return "python";
  return undefined;
}

const SPECIFIER_CONTEXT = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*$/;

/**
 * Blank out JS/TS comments, and blank the contents of every string that isn't
 * in a specifier position (after `from`, `import`, `require(` or `import(`).
 * So code samples inside strings can't produce imports either.
 * Regex literals are not lexed, so a `//` inside one may blank the rest of that
 * line. That can only lose an import, never invent one.
 */
export function stripJsComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n" && quote !== "`") break;
        j++;
      }
      const keep = SPECIFIER_CONTEXT.test(out.slice(-48));
      out += keep ? src.slice(i, j + 1) : quote + src.slice(i + 1, j).replace(/[^\n]/g, " ") + quote;
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const JS_PATTERNS = [
  // import x from "y", import {a} from "y", import type {T} from "y", export * from "y"
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?)\s+from\s*(["'])([^"'\n]+)\1/g,
  // import "y" (side effect)
  /\bimport\s*(["'])([^"'\n]+)\1/g,
  // import("y")
  /\bimport\s*\(\s*(["'`])([^"'`\n]+)\1\s*\)/g,
  // require("y")
  /\brequire\s*\(\s*(["'`])([^"'`\n]+)\1\s*\)/g,
];

export function extractJsImports(src: string): string[] {
  const code = stripJsComments(src);
  const found = new Set<string>();
  for (const re of JS_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const spec = m[2].trim();
      if (spec && !spec.includes("${")) found.add(spec);
    }
  }
  return [...found];
}

/** Remove Python comments and string literals (docstrings included). */
export function stripPython(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = src.slice(i, i + 3) === ch.repeat(3);
      const close = triple ? ch.repeat(3) : ch;
      let j = i + close.length;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src.startsWith(close, j)) break;
        if (!triple && src[j] === "\n") break;
        if (src[j] === "\n") out += "\n";
        j++;
      }
      out += '""';
      i = j + close.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export interface PythonImport {
  /** Number of leading dots for relative imports (0 = absolute). */
  level: number;
  /** Dotted module path after the dots ("" for `from . import x`). */
  module: string;
  /** Names imported with `from m import a, b`. They might be submodules. */
  names: string[];
}

export function extractPythonImports(src: string): PythonImport[] {
  const code = stripPython(src)
    // Join explicit line continuations and parenthesised import lists.
    .replace(/\\\n/g, " ")
    .replace(/\(([^)]*)\)/g, (m) => m.replace(/\n/g, " "));
  const out: PythonImport[] = [];
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    let m = /^from\s+(\.*)([\w.]*)\s+import\s+(.+)$/.exec(trimmed);
    if (m) {
      const names = m[3]
        .replace(/[()]/g, "")
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter((s) => s && s !== "*" && /^\w+$/.test(s));
      out.push({ level: m[1].length, module: m[2], names });
      continue;
    }
    m = /^import\s+(.+)$/.exec(trimmed);
    if (m) {
      for (const part of m[1].split(",")) {
        const mod = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[\w.]+$/.test(mod)) out.push({ level: 0, module: mod, names: [] });
      }
    }
  }
  return out;
}
