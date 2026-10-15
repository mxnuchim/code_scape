/** Tree-sitter in the browser: WASM files are served from /wasm (copied by scripts/wasm-files.mjs). */
import { initParsers } from "./parser";

export function initBrowserParsers(): Promise<boolean> {
  return initParsers((file) => `/wasm/${file}`);
}
