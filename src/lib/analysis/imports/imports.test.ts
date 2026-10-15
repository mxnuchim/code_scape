import { describe, expect, it } from "vitest";
import { extractJsImports, extractPythonImports } from "./extract";
import { aliasFromTsconfig, parseJsonc, resolveJsImport, resolvePythonImport, type ResolveContext } from "./resolve";
import { traceImports } from "./trace";
import { buildRepoModel } from "../buildModel";
import { snapshotOf } from "../../testing/fixtures";

describe("extractJsImports", () => {
  it("finds static, dynamic, re-export and require imports", () => {
    const src = `
      import React from "react";
      import { a, b as c } from './a';
      import type { T } from "../types";
      import * as ns from './ns.js';
      import './side-effect';
      export { x } from "./x";
      export * from './all';
      const lazy = () => import("./lazy");
      const cjs = require('./cjs');
      import {
        multi,
        line,
      } from "./multi";
    `;
    expect(extractJsImports(src).sort()).toEqual(
      ["../types", "./a", "./all", "./cjs", "./lazy", "./multi", "./ns.js", "./side-effect", "./x", "react"].sort(),
    );
  });

  it("ignores imports in comments and inside ordinary strings", () => {
    const src = `
      // import a from './commented'
      /* import b from "./blocked" */
      const sample = "import c from './in-a-string'";
      const tpl = \`require('./in-template')\`;
      const url = "http://example.com"; import real from "./real";
    `;
    expect(extractJsImports(src)).toEqual(["./real"]);
  });
});

describe("extractPythonImports", () => {
  it("parses absolute, relative and parenthesised imports, skipping docstrings", () => {
    const src = `
"""
from fake import nothing
"""
import os, json as j
from . import utils
from ..core.models import (
    User,
    Group,
)
from .helpers import parse  # import nope
`;
    expect(extractPythonImports(src)).toEqual([
      { level: 0, module: "os", names: [] },
      { level: 0, module: "json", names: [] },
      { level: 1, module: "", names: ["utils"] },
      { level: 2, module: "core.models", names: ["User", "Group"] },
      { level: 1, module: "helpers", names: ["parse"] },
    ]);
  });
});

describe("resolution", () => {
  const files = new Set([
    "src/index.ts",
    "src/a.ts",
    "src/util.ts",
    "src/components/index.tsx",
    "src/components/Button.tsx",
    "src/data.json",
    "pkg/__init__.py",
    "pkg/core/__init__.py",
    "pkg/core/models.py",
    "pkg/app/views.py",
    "pkg/app/utils.py",
  ]);
  const ctx: ResolveContext = { files, pythonRoots: ["", "src"] };

  it("resolves relative JS specifiers with extensions and index files", () => {
    expect(resolveJsImport("src/index.ts", "./a", ctx)).toBe("src/a.ts");
    expect(resolveJsImport("src/index.ts", "./util.js", ctx)).toBe("src/util.ts");
    expect(resolveJsImport("src/index.ts", "./components", ctx)).toBe("src/components/index.tsx");
    expect(resolveJsImport("src/components/Button.tsx", "../data.json", ctx)).toBe("src/data.json");
    expect(resolveJsImport("src/index.ts", "react", ctx)).toBeUndefined();
    expect(resolveJsImport("src/index.ts", "./missing", ctx)).toBeUndefined();
    expect(resolveJsImport("src/index.ts", "../../escape", ctx)).toBeUndefined();
  });

  it("resolves tsconfig path aliases", () => {
    const alias = aliasFromTsconfig(
      "tsconfig.json",
      parseJsonc(`{
        // comment
        "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], }, },
      }`),
    );
    const withAlias = { ...ctx, alias };
    expect(resolveJsImport("src/index.ts", "@/components/Button", withAlias)).toBe("src/components/Button.tsx");
    expect(resolveJsImport("src/index.ts", "src/a", withAlias)).toBe("src/a.ts");
    expect(resolveJsImport("src/index.ts", "@scope/pkg", withAlias)).toBeUndefined();
  });

  it("resolves Python relative and absolute imports", () => {
    expect(resolvePythonImport("pkg/app/views.py", { level: 1, module: "", names: ["utils"] }, ctx)).toEqual(["pkg/app/utils.py"]);
    expect(resolvePythonImport("pkg/app/views.py", { level: 2, module: "core.models", names: ["User"] }, ctx)).toEqual([
      "pkg/core/models.py",
    ]);
    expect(resolvePythonImport("pkg/app/views.py", { level: 0, module: "pkg.core", names: ["models"] }, ctx).sort()).toEqual(
      ["pkg/core/__init__.py", "pkg/core/models.py"].sort(),
    );
    expect(resolvePythonImport("pkg/app/views.py", { level: 0, module: "os", names: [] }, ctx)).toEqual([]);
  });
});

describe("traceImports", () => {
  it("records only resolved in-repo edges and reports coverage", async () => {
    const model = buildRepoModel(
      snapshotOf(["src/index.ts", "src/a.ts", "src/b.ts", "src/broken.ts", "README.md"]),
    );
    const sources: Record<string, string | null> = {
      "src/index.ts": `import { a } from "./a"; import x from "lodash"; // import b from "./b"`,
      "src/a.ts": `export * from "./b";`,
      "src/b.ts": `export const b = 1;`,
      "src/broken.ts": null,
    };
    const progress: number[] = [];
    const graph = await traceImports(model, {
      signal: new AbortController().signal,
      fetchText: async (p) => sources[p] ?? null,
      onProgress: (p) => progress.push(p.done),
    });
    expect(graph.edges).toEqual([
      { from: "src/a.ts", to: "src/b.ts" },
      { from: "src/index.ts", to: "src/a.ts" },
    ]);
    expect(graph.incoming.get("src/b.ts")).toEqual(["src/a.ts"]);
    expect(graph.eligible).toBe(4);
    expect(graph.traced.size).toBe(3);
    expect([...graph.failed]).toEqual(["src/broken.ts"]);
    expect(progress.at(-1)).toBe(4);
  });

  it("stops when cancelled", async () => {
    const model = buildRepoModel(snapshotOf(["a.ts", "b.ts"]));
    const controller = new AbortController();
    controller.abort();
    await expect(
      traceImports(model, { signal: controller.signal, fetchText: async () => "" }),
    ).rejects.toThrow();
  });
});
