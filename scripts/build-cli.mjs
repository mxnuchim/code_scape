// Bundle the `codescape` CLI (local viewer launcher and analysis printer) into dist/cli.mjs
// and copy the tree-sitter WASM files next to it.
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { copyWasm } from "./wasm-files.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "wasm"), { recursive: true });

await build({
  entryPoints: [join(root, "src/cli/bin.ts")],
  outfile: join(out, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  legalComments: "linked",
  tsconfig: join(root, "tsconfig.json"),
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Some bundled dependencies are CommonJS and call require().
      'import { createRequire as __codescapeCreateRequire } from "node:module";',
      "const require = __codescapeCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "warning",
});

copyWasm(join(out, "wasm"));
console.log("Built dist/cli.mjs and dist/wasm/");
