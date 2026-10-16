/**
 * Code intelligence types: what we know about the *contents* of files, as
 * opposed to the tree-level model in ../types.ts.
 *
 * Every relationship carries a `basis` so consumers (the UI and the CLI)
 * can say how it is known. Runtime behaviour is never represented here: all of
 * this is read from source text without executing it.
 */
import type { RustCrate } from "../imports/resolveRust";

/**
 * How a claim is known.
 * - fact: read directly from the file tree or a manifest.
 * - static-analysis: established by parsing source and resolving names.
 * - heuristic: inferred from naming conventions or structure; may be wrong.
 */
export type Basis = "fact" | "static-analysis" | "heuristic";

/** 1-based, inclusive line range. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface Evidence extends LineRange {
  path: string;
}

export type CodeLanguage = "ts" | "tsx" | "js" | "python" | "go" | "rust" | "java";

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "handler";

export interface CodeSymbol {
  /** Stable id: `<path>#<qualifiedName>`. Unique within a repository snapshot. */
  id: string;
  name: string;
  /** `Class.method` for methods, otherwise the name. */
  qualifiedName: string;
  kind: SymbolKind;
  path: string;
  range: LineRange;
  exported: boolean;
  /** First line of a leading doc comment / docstring, when present. */
  doc?: string;
  /**
   * For variables initialised with `new X()`, and Java fields declared with a
   * type (used to resolve `x.method()`).
   */
  instanceOf?: string;
  /** Java methods and constructors: parameter count, to tell overloads apart. */
  params?: number;
}

export interface ImportBinding {
  /** Name bound in the importing file. */
  local: string;
  /** Name in the target module: an export name, "default", or "*" for a namespace. */
  imported: string;
}

export type ImportKind = "static" | "dynamic" | "require" | "reexport";

export interface ImportRecord {
  specifier: string;
  line: number;
  kind: ImportKind;
  typeOnly: boolean;
  bindings: ImportBinding[];
  /** Python only: leading dots and dotted module, for the resolver. */
  python?: { level: number; module: string; names: string[] };
  /** Rust only: the `use` path split on `::`, or a `mod name;` declaration. */
  rust?: { path: string[]; glob: boolean; isMod?: boolean };
  /** Java only: `import static` and `.*` imports. */
  java?: { static: boolean; wildcard: boolean };
  /** Repository files this import resolves to (set by the indexer). Empty: external or unresolved. */
  targets?: string[];
}

export interface CallSite {
  /** `name`, `obj.name`, `this.name`, `self.name` or `new:Name`. */
  callee: string;
  line: number;
  /** Symbol id of the innermost enclosing function/method/handler, if any. */
  enclosing?: string;
  /**
   * Rust and Java: the declared type of the receiver in `x.m()`, read from a
   * parameter, local, field or struct-field declaration in the same file.
   */
  receiverType?: string;
  /** Java: number of arguments, to pick between overloads. */
  argCount?: number;
}

export type RouteFramework =
  | "next-app-router"
  | "next-app-page"
  | "next-pages-api"
  | "express-style"
  | "flask-style"
  | "go-http"
  | "rust-attribute"
  | "axum"
  | "spring";

export interface RouteDecl {
  method: string;
  /** URL path as written in source (or derived from the file path for Next.js). */
  route: string;
  line: number;
  framework: RouteFramework;
  /** Symbol id of the handler when it is declared in this file. */
  handler?: string;
  /** Callee text when the handler is a reference, e.g. `users.create`. */
  handlerRef?: string;
}

export interface ParsedFile {
  path: string;
  language: CodeLanguage;
  parser: "tree-sitter" | "regex";
  lineCount: number;
  symbols: CodeSymbol[];
  imports: ImportRecord[];
  calls: CallSite[];
  routes: RouteDecl[];
  /**
   * JS/TS: export name → local name (a symbol's qualifiedName, or an imported
   * binding being re-exported). Python and Go export by naming rules instead.
   */
  exports: Record<string, string>;
  /**
   * Line of `if __name__ == "__main__":`, Go `func main` in package main, Rust
   * `fn main` in a binary crate root, or Java `public static void main`.
   */
  mainAt?: number;
  /** Go: the package clause name. */
  goPackage?: string;
  /** Java: the package declaration. */
  javaPackage?: string;
  /** Set when the parser reported syntax errors; results may be partial. */
  partial?: boolean;
}

export type EdgeKind = "import" | "call";

/** A resolved, in-repository relationship. Never inferred from names alone. */
export interface CodeEdge {
  kind: EdgeKind;
  /** File path for imports; symbol id (or file path for module scope) for calls. */
  from: string;
  to: string;
  fromPath: string;
  toPath: string;
  basis: Basis;
  /** Where in `fromPath` the relationship is written. */
  lines: number[];
  /** Import edges: true when every import between the files is type-only. */
  typeOnly?: boolean;
}

/** A call or import that leaves the repository (a package or the standard library). */
export interface ExternalRef {
  path: string;
  line: number;
  module: string;
  callee?: string;
  enclosing?: string;
}

export interface CodeIndexLimits {
  /** Files in a parseable language. */
  eligible: number;
  parsed: number;
  /** Eligible files not parsed because of the file cap, byte budget or size limit. */
  skipped: number;
  skippedLarge: number;
  failed: string[];
  /** Files whose content is withheld as potentially sensitive. */
  withheld: string[];
  /** Files parsed with the regex fallback (imports only). */
  fallback: number;
  cap: number;
  aliasSource: string | null;
  timedOut: boolean;
}

export interface CodeIndex {
  files: Record<string, ParsedFile>;
  importEdges: CodeEdge[];
  callEdges: CodeEdge[];
  external: ExternalRef[];
  /** Rust crates found from Cargo.toml files, for resolving `use` paths later (journeys). */
  rustCrates?: RustCrate[];
  limits: CodeIndexLimits;
}
