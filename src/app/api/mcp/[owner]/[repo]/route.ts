/**
 * The hosted MCP endpoint: `https://<site>/api/mcp/<owner>/<repo>`.
 * Streamable HTTP, stateless; see src/mcp/remote.ts.
 */
import { createRemoteMcpHandler } from "@/mcp/remote";

export const dynamic = "force-dynamic";
// The first tool call reads and parses up to 600 files from GitHub; later calls hit the in-memory cache.
export const maxDuration = 60;

const handler = createRemoteMcpHandler({
  token: process.env.GITHUB_TOKEN?.trim() || undefined,
  siteUrl: process.env.CODESCAPE_SITE_URL?.trim() || undefined,
});

export function POST(request: Request) {
  return handler.fetch(request);
}

export function GET(request: Request) {
  return handler.fetch(request);
}

export function DELETE(request: Request) {
  return handler.fetch(request);
}
