/**
 * Locate tree-sitter WASM files in Node. Bundled builds ship them in
 * `dist/wasm/`; in development they come straight from node_modules.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initParsers } from "../analysis/code/parser";

const PACKAGE_FOR: Record<string, string> = {
  "web-tree-sitter.wasm": "web-tree-sitter",
  "tree-sitter-typescript.wasm": "tree-sitter-typescript",
  "tree-sitter-tsx.wasm": "tree-sitter-typescript",
  "tree-sitter-javascript.wasm": "tree-sitter-javascript",
  "tree-sitter-python.wasm": "tree-sitter-python",
  "tree-sitter-go.wasm": "tree-sitter-go",
};

function candidateDirs(file: string): string[] {
  const dirs: string[] = [];
  if (process.env.CODESCAPE_WASM_DIR) dirs.push(process.env.CODESCAPE_WASM_DIR);
  try {
    // Next to the running module (the bundled CLI keeps them in ./wasm).
    dirs.push(join(dirname(fileURLToPath(import.meta.url)), "wasm"));
  } catch {
    // import.meta.url may be unavailable in some bundlers.
  }
  const pkg = PACKAGE_FOR[file];
  if (pkg) {
    try {
      dirs.push(dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`)));
    } catch {
      // Fall through to cwd-based lookups.
    }
    dirs.push(join(process.cwd(), "node_modules", pkg));
  }
  dirs.push(join(process.cwd(), "public", "wasm"));
  return dirs;
}

export function locateWasmFile(file: string): Uint8Array {
  for (const dir of candidateDirs(file)) {
    const full = join(dir, file);
    if (existsSync(full)) return new Uint8Array(readFileSync(full));
  }
  throw new Error(`WASM file not found: ${file}`);
}

/** Initialise tree-sitter for Node. Safe to call repeatedly. */
export function initNodeParsers(): Promise<boolean> {
  return initParsers(locateWasmFile);
}
