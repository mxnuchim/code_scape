// After `next build`: fail if the compiled stylesheet is missing rules the app can't work without.
// Guards against a build that ships new components with a stale globals.css (see LEARNINGS.md):
// a failed build keeps the previous deployment live instead of shipping unstyled UI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// One selector from each block of hand-written CSS in src/app/globals.css.
const REQUIRED = [".glass-strong", ".hover-pill", ".journey-stop", ".wf-pin", ".wf-district", ".wf-trail-pill"];

function cssFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

let files = [];
try {
  files = cssFiles(join(ROOT, ".next", "static"));
} catch {
  // No build output where we expect it: don't block a build on our own assumption about its layout.
}
if (files.length === 0) {
  console.warn("[check-build-css] No CSS found under .next/static; skipping the check.");
  process.exit(0);
}
const css = files.map((f) => readFileSync(f, "utf8")).join("\n");
const missing = REQUIRED.filter((selector) => !css.includes(selector));
if (missing.length) {
  console.error(`[check-build-css] The built stylesheet is missing: ${missing.join(", ")}.`);
  console.error("[check-build-css] globals.css was probably compiled from a stale cache. Rebuild without the build cache.");
  process.exit(1);
}
console.log(`[check-build-css] Stylesheet OK (${files.length} file${files.length === 1 ? "" : "s"}, ${REQUIRED.length} required rules present).`);
