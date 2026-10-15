import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@/lib/analysis/languages";
import { analysisHint, FEATURED, LIBRARY, LIBRARY_SIZE, searchLibrary, type LibraryRepo } from "./repoLibrary";

const name = (id: string) => LANGUAGES[id]?.name ?? id;
const all = LIBRARY.flatMap((c) => c.repos);
const repo = (over: Partial<LibraryRepo>): LibraryRepo => ({ owner: "o", repo: "r", title: "T", hook: "h", language: "go", files: 10, sourceFiles: 10, ...over });

describe("repository library", () => {
  it("lists each repository once, with a known language and sane counts", () => {
    const slugs = all.map((r) => `${r.owner}/${r.repo}`.toLowerCase());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(LIBRARY_SIZE).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const r of all) {
      expect(LANGUAGES[r.language], `${r.owner}/${r.repo} language`).toBeDefined();
      expect(r.sourceFiles).toBeLessThanOrEqual(r.files);
      expect(r.hook.length).toBeLessThanOrEqual(110);
      expect(r.hook).not.toMatch(/`/);
    }
  });

  it("features only repositories that are in the library", () => {
    expect(FEATURED.length).toBeGreaterThanOrEqual(4);
    expect(FEATURED.length).toBeLessThanOrEqual(6);
    for (const f of FEATURED) expect(all.some((r) => r.owner === f.owner && r.repo === f.repo)).toBe(true);
  });

  it("never lists closed-source products", () => {
    const text = all.map((r) => `${r.owner} ${r.repo} ${r.title}`).join(" ").toLowerCase();
    for (const closed of ["instagram", "snapchat", "whatsapp"]) expect(text).not.toContain(closed);
  });
});

describe("analysisHint", () => {
  it("is full when every parseable file fits the browser budget", () => {
    expect(analysisHint(repo({ sourceFiles: 300 }), name).depth).toBe("full");
  });

  it("is partial above the budget, and says how much is parsed", () => {
    const hint = analysisHint(repo({ files: 20_000, sourceFiles: 17_937 }), name);
    expect(hint.depth).toBe("partial");
    expect(hint.detail).toContain("300 of about 17.9K");
  });

  it("is map-only for an unparsed language with few parseable files", () => {
    const hint = analysisHint(repo({ language: "c", files: 543, sourceFiles: 0 }), name);
    expect(hint.depth).toBe("map");
    expect(hint.detail).toContain("Mostly C");
  });

  it("is partial for an unparsed language with many parseable files", () => {
    expect(analysisHint(repo({ language: "scala", sourceFiles: 1253 }), name).depth).toBe("partial");
  });

  it("mentions a truncated listing", () => {
    const hint = analysisHint(repo({ language: "c", sourceFiles: 126, truncated: true }), name);
    expect(hint.detail).toContain("truncates");
  });
});

describe("searchLibrary", () => {
  it("returns everything for an empty query", () => {
    expect(searchLibrary("  ", name)).toBe(LIBRARY);
  });

  it("matches keywords, owners and languages, and needs every word", () => {
    const slugs = (q: string) => searchLibrary(q, name).flatMap((c) => c.repos.map((r) => `${r.owner}/${r.repo}`));
    expect(slugs("docker")).toContain("moby/moby");
    expect(slugs("Netflix")).toEqual(["Netflix/zuul"]);
    expect(slugs("rust editor")).toEqual(["zed-industries/zed"]);
    expect(slugs("no such thing")).toEqual([]);
  });
});
