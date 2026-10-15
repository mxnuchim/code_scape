"use client";

import { useSyncExternalStore } from "react";
import type { RepoRef } from "@/lib/github/types";
import { CopyButton, Section } from "./common";

const noSubscription = () => () => {};

/** `codescape-next-js` for vercel/next.js: a server name Claude Code accepts. */
export function mcpServerName(repo: string): string {
  return `codescape-${repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo"}`;
}

export function mcpEndpoint(origin: string, ref: RepoRef): string {
  const url = new URL(`/api/mcp/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`, origin);
  if (ref.ref) url.searchParams.set("ref", ref.ref);
  return url.toString();
}

/**
 * "Ask Claude about it": the one command that connects Claude Code to this
 * repository's hosted MCP endpoint (same analysis as the map, path:line
 * citations, links back here).
 */
export function ClaudeConnect({ repo }: { repo: RepoRef }) {
  // The site's own origin; null while rendering on the server, so the markup agrees.
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => null);
  if (!origin) return null;
  const endpoint = mcpEndpoint(origin, repo);
  // Quoted: zsh treats an unquoted `?` (from `?ref=`) as a glob.
  const command = `claude mcp add --transport http ${mcpServerName(repo.repo)} "${endpoint}"`;
  return (
    <Section title="Ask Claude about it">
      <p className="mb-2.5 text-[0.8rem] leading-relaxed text-ink-soft">
        Connect Claude Code to this repository. It answers from the same analysis as this map, cites <span className="font-mono">path:line</span>, and links
        back here. Run this in a terminal:
      </p>
      <pre className="mb-2 overflow-x-auto rounded-md bg-black/30 px-3 py-2.5 font-mono text-[0.72rem] leading-relaxed whitespace-pre-wrap break-all text-ink ring-1 ring-white/[0.06]">
        {command}
      </pre>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={command} label="Copy command" />
        <CopyButton text={endpoint} label="Copy server URL" />
      </div>
      <p className="mt-2.5 text-[0.72rem] leading-relaxed text-ink-faint">
        Then ask, for example, &ldquo;How does a request reach the database? Show me in CodeScape.&rdquo; The server URL also works as a custom connector in other MCP
        clients. Public repositories only: for private code, run CodeScape on your machine.
      </p>
    </Section>
  );
}
