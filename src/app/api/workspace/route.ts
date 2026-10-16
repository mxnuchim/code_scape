import { NO_ROOT_MESSAGE, rejectNonLocal, serverWorkspace } from "@/lib/local/server";

export const dynamic = "force-dynamic";

/** The full analysis of the configured repository (the same analysis GitHub mode runs in the browser). */
export async function GET(request: Request) {
  const rejected = rejectNonLocal(request);
  if (rejected) return rejected;
  const ws = serverWorkspace();
  if (!ws) return Response.json({ error: NO_ROOT_MESSAGE }, { status: 404 });
  try {
    const { analysis } = await (await ws).get();
    return Response.json(analysis, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[codescape] analysis failed:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Analysis failed" }, { status: 500 });
  }
}
