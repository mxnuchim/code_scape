// The tree-sitter WASM files CodeScape needs, and where they come from.
// Used by the CLI bundle (dist/wasm) and the web app (public/wasm).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const WASM_FILES = {
  "web-tree-sitter.wasm": "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-typescript.wasm": "tree-sitter-typescript/tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm": "tree-sitter-typescript/tree-sitter-tsx.wasm",
  "tree-sitter-javascript.wasm": "tree-sitter-javascript/tree-sitter-javascript.wasm",
  "tree-sitter-python.wasm": "tree-sitter-python/tree-sitter-python.wasm",
  "tree-sitter-go.wasm": "tree-sitter-go/tree-sitter-go.wasm",
};

/** Copy every WASM file into `dir`. They are direct dependencies, so pnpm links them at node_modules/<pkg>. */
export function copyWasm(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, spec] of Object.entries(WASM_FILES)) copyFileSync(join(ROOT, "node_modules", spec), join(dir, name));
}

// `node scripts/wasm-files.mjs` copies them into public/wasm for the browser.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  copyWasm(join(ROOT, "public", "wasm"));
  console.log("Copied tree-sitter WASM files to public/wasm/");
}
