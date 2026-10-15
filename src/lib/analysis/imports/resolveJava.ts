/**
 * Java import resolution. Source roots (`src/main/java/`, `app/src/test/java/`,
 * or the repository root) are derived from parsed files whose folder matches
 * their `package` declaration, then `com.x.Y` resolves to `<root>/com/x/Y.java`
 * when that file exists.
 */
import type { RepoModel } from "../types";
import type { ImportRecord, ParsedFile } from "../code/types";
import { dirname } from "./resolve";

export interface JavaImportTarget {
  files: string[];
  /** For single-type and static imports: the declaration inside the file (`Y`, `Outer.Inner`, `Strings.trim`). */
  item?: string;
}

/** Folders that hold package trees, e.g. "src/main/java/" ("" for the root). */
export function javaSourceRoots(files: Iterable<ParsedFile>): string[] {
  const roots = new Set<string>();
  for (const f of files) {
    if (f.language !== "java" || !f.javaPackage) continue;
    const pkgDir = f.javaPackage.replace(/\./g, "/");
    const dir = dirname(f.path);
    if (dir === pkgDir) roots.add("");
    else if (dir.endsWith(`/${pkgDir}`)) roots.add(dir.slice(0, dir.length - pkgDir.length));
  }
  return [...roots].sort();
}

export function resolveJavaImport(rec: ImportRecord, roots: string[], model: RepoModel): JavaImportTarget {
  const name = rec.specifier.replace(/\.\*$/, "");
  const segs = name.split(".");
  const wildcard = rec.java?.wildcard ?? false;
  const isStatic = rec.java?.static ?? false;
  for (const root of roots) {
    if (wildcard && !isStatic) {
      // `import com.x.*`: every class in that package.
      const dir = model.dirsByPath.get(`${root}${segs.join("/")}`);
      const files = (dir?.files ?? []).filter((f) => f.name.endsWith(".java")).map((f) => f.path);
      if (files.length) return { files };
      continue;
    }
    // The longest prefix that is a file is the top-level class; the rest is nested types or a member.
    for (let k = segs.length; k >= 1; k--) {
      const file = `${root}${segs.slice(0, k).join("/")}.java`;
      if (!model.filesByPath.has(file)) continue;
      const item = segs.slice(k - 1).join(".");
      return wildcard ? { files: [file] } : { files: [file], item };
    }
  }
  return { files: [] };
}

/** The package an unresolved import comes from, for "leaves the repository" steps. */
export function javaPackageOf(rec: ImportRecord): string {
  const segs = rec.specifier.replace(/\.\*$/, "").split(".");
  if (rec.java?.wildcard && !rec.java.static) return segs.join(".");
  // Drop the class (and the member for static imports); keep lowercase package segments.
  const pkg: string[] = [];
  for (const s of segs) {
    if (/^[A-Z]/.test(s)) break;
    pkg.push(s);
  }
  return pkg.length ? pkg.join(".") : segs.slice(0, -1).join(".");
}
