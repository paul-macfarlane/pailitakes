import { z } from "zod";

import {
  PageViewIngestStatus,
  recordPageView,
} from "@/lib/analytics/service/ingest";

const bodySchema = z.object({
  path: z.string().min(1).max(512).startsWith("/"),
  postId: z.uuid().optional(),
});

// Analytics beacon (design §5.6, ANLY-2): public, unauthenticated write, once
// per pageview, fired by src/components/view-beacon.tsx via
// navigator.sendBeacon. Reads the raw body as text rather than
// request.json() because sendBeacon's Blob payload may arrive without an
// application/json content type — JSON.parse runs explicitly instead.
export async function POST(request: Request) {
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  // Vercel sets x-forwarded-for; empty locally is fine — the hash still
  // salts per-day (design §5.6).
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";

  const status = await recordPageView({
    path: parsed.data.path,
    postId: parsed.data.postId,
    ip,
    userAgent,
  });

  if (status === PageViewIngestStatus.Disabled) {
    return Response.json({ error: "Analytics disabled" }, { status: 503 });
  }

  // Recorded and Dropped both 204: deliberately indistinguishable to the
  // caller — a "was this dropped as a bot" oracle would help evasion.
  return new Response(null, { status: 204 });
}
