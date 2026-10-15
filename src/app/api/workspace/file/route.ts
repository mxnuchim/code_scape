import { NO_ROOT_MESSAGE, rejectNonLocal, serverWorkspace } from "@/lib/local/server";
import { PathAccessError } from "@/lib/local/safety";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { "invalid-path": 400, "outside-root": 403, withheld: 403, "not-found": 404, "not-a-file": 400, binary: 415, "too-large": 413 };

/** A bounded, redacted excerpt of one file: ?path=src/a.ts&start=10&end=40 */
export async function GET(request: Request) {
  const rejected = rejectNonLocal(request);
  if (rejected) return rejected;
  const ws = serverWorkspace();
  if (!ws) return Response.json({ error: NO_ROOT_MESSAGE }, { status: 404 });
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const start = Math.max(1, Number(url.searchParams.get("start")) || 1);
  const end = Math.max(start, Number(url.searchParams.get("end")) || start + 60);
  try {
    const excerpt = await (await ws).excerpt(path, start, end, 400);
    return Response.json(excerpt, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof PathAccessError) return Response.json({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
    return Response.json({ error: "Could not read the file." }, { status: 500 });
  }
}
