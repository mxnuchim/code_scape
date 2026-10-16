import { describe, expect, it } from "vitest";
import { parseArgs } from "./index";
import { buildDeepLink } from "./viewer";

describe("CLI", () => {
  it("resolves the root from --root, then CODESCAPE_ROOT", () => {
    expect(parseArgs(["view", "--root", "/tmp/a"], { CODESCAPE_ROOT: "/tmp/b" }).root).toBe("/tmp/a");
    expect(parseArgs(["view"], { CODESCAPE_ROOT: "/tmp/b" }).root).toBe("/tmp/b");
    expect(() => parseArgs(["view", "--bogus"], {})).toThrow(/Unknown option/);
    expect(() => parseArgs(["view", "--port", "0"], {})).toThrow(/port/);
  });

  it("builds viewer deep links to a file, declaration or journey", () => {
    const url = new URL(buildDeepLink("http://127.0.0.1:4317", { path: "src/db/client.ts", symbol: "s1", journey: "j1" }));
    expect(url.pathname).toBe("/local");
    expect(url.searchParams.get("select")).toBe("src/db/client.ts");
    expect(url.searchParams.get("symbol")).toBe("s1");
    expect(url.searchParams.get("journey")).toBe("j1");
  });
});
