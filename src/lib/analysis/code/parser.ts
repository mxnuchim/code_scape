/**
 * Tree-sitter parsing, isomorphic: the same code runs in Node (the CLI,
 * Next.js route handlers, tests) and in the browser (GitHub mode). Only the
 * way WASM files are located differs, so callers supply a `WasmLocator`.
 *
 * If the runtime or a grammar can't be loaded, parsing falls back to the
 * regex import extractors (see ./fallback.ts). That loses symbols and calls,
 * never correctness of what is reported.
 */
import { Language, Parser } from "web-tree-sitter";
import type { CodeLanguage, ParsedFile } from "./types";
import { extractGo } from "./extract-go";
import { extractJava } from "./extract-java";
import { extractJs } from "./extract-js";
import { extractPython } from "./extract-python";
import { extractRust } from "./extract-rust";
import { parseWithRegex } from "./fallback";

export const GRAMMAR_FILES: Record<CodeLanguage, string> = {
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  js: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
};
export const RUNTIME_WASM = "web-tree-sitter.wasm";

/**
 * Resolves a WASM file name (one of GRAMMAR_FILES or RUNTIME_WASM) to a URL,
 * a filesystem path, or the bytes themselves.
 */
export type WasmLocator = (file: string) => string | Uint8Array | Promise<string | Uint8Array>;

export function codeLanguageFor(path: string): CodeLanguage | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) return undefined;
  if (/\.(ts|mts|cts)$/.test(lower)) return "ts";
  if (lower.endsWith(".tsx")) return "tsx";
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return "js";
  if (/\.(py|pyi)$/.test(lower)) return "python";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".java")) return "java";
  return undefined;
}

/** Languages we can extract imports from, with or without tree-sitter. */
export function isParseable(path: string): boolean {
  return codeLanguageFor(path) !== undefined || /\.(vue|svelte|astro)$/i.test(path);
}

interface Runtime {
  parser: Parser;
  languages: Map<CodeLanguage, Language | null>;
  locate: WasmLocator;
}

let runtime: Promise<Runtime | null> | null = null;
let resolvedRuntime: Runtime | null = null;

async function toLoadable(value: string | Uint8Array | Promise<string | Uint8Array>) {
  return await value;
}

/** Initialise the tree-sitter runtime once. Resolves to false if it can't load. */
export async function initParsers(locate: WasmLocator): Promise<boolean> {
  if (!runtime) {
    runtime = (async () => {
      try {
        const where = await toLoadable(locate(RUNTIME_WASM));
        await Parser.init(
          typeof where === "string" ? { locateFile: () => where } : { wasmBinary: where },
        );
        return { parser: new Parser(), languages: new Map(), locate };
      } catch (err) {
        logParserIssue("tree-sitter runtime failed to load", err);
        return null;
      }
    })();
  }
  resolvedRuntime = await runtime;
  return resolvedRuntime !== null;
}

/** For tests: forget the loaded runtime. */
export function resetParsers() {
  runtime = null;
  resolvedRuntime = null;
}

async function languageFor(rt: Runtime, lang: CodeLanguage): Promise<Language | null> {
  if (rt.languages.has(lang)) return rt.languages.get(lang)!;
  let loaded: Language | null = null;
  try {
    loaded = await Language.load(await toLoadable(rt.locate(GRAMMAR_FILES[lang])));
  } catch (err) {
    logParserIssue(`grammar ${GRAMMAR_FILES[lang]} failed to load`, err);
  }
  rt.languages.set(lang, loaded);
  return loaded;
}

/** Load the grammars needed for these paths up front, so parsing can be synchronous. */
export async function prepareLanguages(paths: Iterable<string>): Promise<void> {
  const rt = runtime ? await runtime : null;
  if (!rt) return;
  const needed = new Set<CodeLanguage>();
  for (const p of paths) {
    const lang = codeLanguageFor(p);
    if (lang) needed.add(lang);
  }
  await Promise.all([...needed].map((l) => languageFor(rt, l)));
}

/**
 * Parse one file. Synchronous; call `initParsers` and `prepareLanguages` first
 * to get tree-sitter results, otherwise the regex fallback is used.
 */
export function parseSource(path: string, text: string): ParsedFile {
  const lang = codeLanguageFor(path);
  const rt = resolvedRuntime;
  const language = lang && rt ? rt.languages.get(lang) : null;
  if (!lang || !rt || !language) return parseWithRegex(path, text, lang);

  rt.parser.setLanguage(language);
  const tree = rt.parser.parse(text);
  if (!tree) return parseWithRegex(path, text, lang);
  try {
    const root = tree.rootNode;
    const result =
      lang === "python"
        ? extractPython(path, root)
        : lang === "go"
          ? extractGo(path, root)
          : lang === "rust"
            ? extractRust(path, root)
            : lang === "java"
              ? extractJava(path, root)
              : extractJs(path, lang, root);
    result.lineCount = text.length === 0 ? 0 : root.endPosition.row + 1;
    if (root.hasError) result.partial = true;
    return result;
  } finally {
    tree.delete();
  }
}

function logParserIssue(message: string, err: unknown) {
  // stderr only: `codescape analyze --json` writes its result to stdout.
  if (typeof console !== "undefined") console.error(`[codescape] ${message}:`, err instanceof Error ? err.message : err);
}
