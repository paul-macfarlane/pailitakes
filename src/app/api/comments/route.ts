import { z } from "zod";

import { loadCommentThread } from "@/lib/comments/service/read";

const querySchema = z.object({ postId: z.uuid() });

// Comment tree reads (design §5.3, CMT-2, D5): no-store by construction —
// reading the request URL's searchParams opts this handler out of static
// generation, same as the cron route reading its Authorization header
// (src/app/api/cron/revalidate/route.ts). Writes stay in server actions
// (src/actions/comments.ts); this route only ever reads.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    postId: url.searchParams.get("postId") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid postId." }, { status: 400 });
  }

  const result = await loadCommentThread(parsed.data.postId);
  if (!result.ok) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json(result.thread);
}
