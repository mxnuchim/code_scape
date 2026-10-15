import { configuredRoot, rejectNonLocal } from "@/lib/local/server";

export const dynamic = "force-dynamic";

/** Identifies this server as a CodeScape viewer and which repository it serves. */
export async function GET(request: Request) {
  const rejected = rejectNonLocal(request);
  if (rejected) return rejected;
  const root = configuredRoot();
  let real: string | null = null;
  if (root) {
    try {
      const { realpath } = await import("node:fs/promises");
      real = await realpath(root);
    } catch {
      real = root;
    }
  }
  return Response.json({ app: "codescape", root: real }, { headers: { "cache-control": "no-store" } });
}
