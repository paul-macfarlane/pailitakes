import { analyticsQuerySchema } from "@/lib/analytics/input";
import { getAnalyticsSummary } from "@/lib/analytics/service/aggregates";
import { getSession } from "@/lib/auth/session";
import { NOT_AUTHORIZED_ERROR } from "@/lib/shared/action-result";

// Admin analytics dashboard reads (design §3/§5.6, ANLY-5): deliberately
// uncached, client-fetched with TanStack Query — same reasoning as
// src/app/api/comments/route.ts. Reading the session below makes this
// route's response per-viewer and forces it dynamic/no-store.
export async function GET(request: Request) {
  const url = new URL(request.url);
  // range/granularity are admin-only *filter* params — invalid input
  // degrades to defaults via the schema's `.catch`, it never 400s
  // (engineering rule: only PUBLIC route params notFound()/400 on garbage).
  const query = analyticsQuerySchema.parse({
    range: url.searchParams.get("range") ?? undefined,
    granularity: url.searchParams.get("granularity") ?? undefined,
  });

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const result = await getAnalyticsSummary(session.user, query);
  if (!result.ok) {
    const status = result.error === NOT_AUTHORIZED_ERROR ? 403 : 400;
    return Response.json({ error: result.error }, { status });
  }

  return Response.json(result.data);
}
