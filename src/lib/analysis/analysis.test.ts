import { describe, expect, it } from "vitest";
import { classifyFile, detectLandmark } from "./classify";
import { excludedFileReason, excludedPathMatch } from "./exclusions";
import { buildRepoModel } from "./buildModel";
import { snapshotOf, syntheticRepo } from "../testing/fixtures";

describe("classifyFile", () => {
  it.each([
    ["src/index.ts", "typescript", "source"],
    ["src/button.test.tsx", "typescript", "test"],
    ["tests/test_app.py", "python", "test"],
    ["pkg/server_test.go", "go", "test"],
    ["src/__tests__/util.js", "javascript", "test"],
    ["tsconfig.json", "json", "config"],
    ["vite.config.ts", "typescript", "config"],
    [".eslintrc.cjs", "javascript", "config"],
    ["package.json", "json", "config"],
    [".github/workflows/ci.yml", "yaml", "build"],
    ["Dockerfile", "docker", "build"],
    ["Makefile", "make", "build"],
    ["README.md", "markdown", "docs"],
    ["docs/guide/intro.mdx", "mdx", "docs"],
    ["LICENSE", "text", "docs"],
    ["src/styles/app.module.css", "css", "style"],
    ["data/cities.csv", "csv", "data"],
    ["src/schema.graphql", "graphql", "data"],
    ["public/logo.svg", "image", "asset"],
    ["fonts/inter.woff2", "font", "asset"],
    ["bin/weird.xyz", "other", "other"],
  ])("%s → %s / %s", (path, language, category) => {
    expect(classifyFile(path)).toEqual({ language, category });
  });

  it("recognises landmarks by naming convention", () => {
    const pkgs = new Set(["packages/core"]);
    expect(detectLandmark("README.md", "docs", pkgs)).toBe("readme");
    expect(detectLandmark("docs/README.md", "docs", pkgs)).toBeUndefined();
    expect(detectLandmark("LICENSE", "docs", pkgs)).toBe("license");
    expect(detectLandmark("package.json", "config", pkgs)).toBe("manifest");
    expect(detectLandmark("packages/core/package.json", "config", pkgs)).toBe("manifest");
    expect(detectLandmark("src/index.ts", "source", pkgs)).toBe("entry");
    expect(detectLandmark("packages/core/src/index.ts", "source", pkgs)).toBe("entry");
    expect(detectLandmark("src/deep/index.ts", "source", pkgs)).toBeUndefined();
    expect(detectLandmark("cmd/tool/main.go", "source", pkgs)).toBe("entry");
    expect(detectLandmark("src/app/page.tsx", "source", pkgs)).toBe("entry");
    expect(detectLandmark("src/flask/__main__.py", "source", pkgs)).toBe("entry");
    expect(detectLandmark("src/flask/app.py", "source", pkgs)).toBeUndefined();
    expect(detectLandmark("app.py", "source", pkgs)).toBe("entry");
    expect(detectLandmark("src/index.test.ts", "test", pkgs)).toBeUndefined();
  });
});

describe("exclusions", () => {
  it("skips dependencies, build output and generated files", () => {
    expect(excludedPathMatch("node_modules/react/index.js")).toEqual({ dir: "node_modules", reason: "dependencies" });
    expect(excludedPathMatch("packages/a/node_modules/x/y.js")?.dir).toBe("packages/a/node_modules");
    expect(excludedPathMatch("dist/bundle.js")?.reason).toBe("build output");
    expect(excludedPathMatch("src/index.ts")).toBeUndefined();
    expect(excludedPathMatch("src/compiler/passes/build/x.ts")).toBeUndefined();
    expect(excludedFileReason("pnpm-lock.yaml")).toBe("lockfiles");
    expect(excludedFileReason("app.min.js")).toBe("generated files");
    expect(excludedFileReason(".DS_Store")).toBe("OS files");
    expect(excludedFileReason("index.ts")).toBeUndefined();
  });
});

describe("buildRepoModel", () => {
  it("builds the hierarchy and reports exclusions honestly", () => {
    const model = buildRepoModel(
      snapshotOf([
        "README.md",
        "package.json",
        "package-lock.json",
        "src/index.ts",
        "src/lib/util.ts",
        "node_modules/react/index.js",
        "node_modules/react/package.json",
      ]),
    );
    expect(model.files.map((f) => f.path)).toEqual(["README.md", "package.json", "src/index.ts", "src/lib/util.ts"]);
    expect(model.excluded.files).toBe(3);
    expect(model.excluded.byReason).toEqual({ dependencies: 2, lockfiles: 1 });
    expect(model.excluded.topDirs[0]).toEqual({ path: "node_modules", files: 2, reason: "dependencies" });
    expect(model.root.dirs.map((d) => d.path)).toEqual(["src"]);
    expect(model.dirsByPath.get("src")!.stats.files).toBe(2);
    expect(model.stats.files).toBe(4);
    expect(model.limits.aggregatedDirs).toEqual([]);
  });

  it("is independent of the order GitHub returns entries in", () => {
    const paths = syntheticRepo(200);
    const a = buildRepoModel(snapshotOf(paths));
    const b = buildRepoModel(snapshotOf([...paths].reverse()));
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
  });

  it("aggregates folders to fit the building budget and says so", () => {
    const model = buildRepoModel(snapshotOf(syntheticRepo(1200)), { budget: 300 });
    const renderedFiles = model.files.filter((f) => !f.aggregatedInto).length;
    const blocks = new Set(model.files.map((f) => f.aggregatedInto).filter(Boolean)).size;
    expect(renderedFiles + blocks).toBeLessThanOrEqual(300);
    expect(model.limits.aggregatedDirs.length).toBeGreaterThan(0);
    // Upper structure survives: top-level folders are still folders.
    expect(model.root.dirs.map((d) => d.name)).toEqual(["assets", "docs", "packages", "src", "tests"]);
    // Every aggregated file points at a folder that exists and is marked aggregated.
    for (const f of model.files) {
      if (f.aggregatedInto !== undefined) expect(model.dirsByPath.get(f.aggregatedInto)?.aggregated).toBe(true);
    }
  });

  it("keeps the truncation flag", () => {
    expect(buildRepoModel(snapshotOf(["a.ts"], { truncated: true })).limits.truncated).toBe(true);
  });
});
