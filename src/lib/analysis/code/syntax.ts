/** Small helpers shared by the per-language tree-sitter extractors. */
import type { Node } from "web-tree-sitter";
import type { LineRange } from "./types";

export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function lineRange(node: Node): LineRange {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

const STRING_TYPES = new Set([
  "string",
  "template_string",
  "interpreted_string_literal",
  "raw_string_literal",
]);

/** The literal value of a string node, or undefined if it isn't a plain literal. */
export function stringValue(node: Node): string | undefined {
  if (!STRING_TYPES.has(node.type)) return undefined;
  let text = node.text;
  if (node.type === "template_string" && text.includes("${")) return undefined;
  // Python string prefixes (r, b, u, f): an f-string with a placeholder isn't a literal.
  const prefix = /^[rRbBuUfF]{0,2}/.exec(text)?.[0] ?? "";
  if (/f/i.test(prefix) && text.includes("{")) return undefined;
  text = text.slice(prefix.length);
  for (const q of ['"""', "'''", '"', "'", "`"]) {
    if (text.startsWith(q) && text.endsWith(q) && text.length >= q.length * 2) return text.slice(q.length, text.length - q.length);
  }
  return undefined;
}

/**
 * First meaningful line of the comment block directly above `node`
 * (JSDoc, `//`, `#`), trimmed to 160 characters.
 */
export function docLine(node: Node): string | undefined {
  const prev = node.previousNamedSibling;
  if (!prev || prev.type !== "comment") return undefined;
  if (prev.endPosition.row < node.startPosition.row - 1) return undefined;
  // Walk up through a run of adjacent line comments.
  let first: Node = prev;
  while (first.previousNamedSibling?.type === "comment" && first.previousNamedSibling.endPosition.row >= first.startPosition.row - 1) {
    first = first.previousNamedSibling;
  }
  const lines: string[] = [];
  for (let c: Node | null = first; c && c.startIndex <= prev.startIndex; c = c.nextNamedSibling) lines.push(c.text);
  return firstMeaningfulLine(lines.join("\n"));
}

export function firstMeaningfulLine(comment: string): string | undefined {
  for (const raw of comment.split("\n")) {
    const line = raw
      .replace(/^\s*(\/\*\*?|\*\/|\*|\/\/+|#+|"""|''')\s?/, "")
      .replace(/\*\/\s*$/, "")
      .replace(/("""|''')\s*$/, "")
      .trim();
    if (line && !line.startsWith("@") && !/^eslint|^prettier|^@ts-|^type:/.test(line)) {
      return line.length > 160 ? `${line.slice(0, 157)}…` : line;
    }
  }
  return undefined;
}

/**
 * Next.js file-system routing. Only the conventions are applied here: a
 * `route.ts` under `app/`, or a file under `pages/api/`.
 */
export function nextRouteFromPath(path: string): { kind: "app" | "page" | "pages"; route: string } | undefined {
  const app = /(?:^|\/)app\/((?:[^/]+\/)*)(route|page)\.(?:ts|js|tsx|jsx|mts|mjs)$/.exec(path);
  if (app) {
    const segments = app[1]
      .split("/")
      .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@") && !s.startsWith("_"));
    return { kind: app[2] === "page" ? "page" : "app", route: `/${segments.join("/")}` };
  }
  const pages = /(?:^|\/)pages\/api\/(.+)\.(?:ts|js|tsx|jsx|mts|mjs)$/.exec(path);
  if (pages) {
    const rest = pages[1].replace(/(^|\/)index$/, "");
    return { kind: "pages", route: `/api${rest ? `/${rest}` : ""}` };
  }
  return undefined;
}
