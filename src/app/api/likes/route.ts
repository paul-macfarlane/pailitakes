import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { getPostLikeState } from "@/lib/likes/service";

const querySchema = z.object({ postId: z.uuid() });

// Post-level like state (design §5.4, LIKE-3): no-store by construction —
// reading the request URL's searchParams opts this handler out of static
// generation, same as GET /api/comments (src/app/api/comments/route.ts).
// Writes stay in server actions (src/actions/likes.ts); this route only
// ever reads.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    postId: url.searchParams.get("postId") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid postId." }, { status: 400 });
  }

  // Reading the session makes this route's response per-viewer (likeCount is
  // shared, likedByMe isn't) — no extra opt-out needed, the searchParams read
  // above already forces this handler dynamic/no-store.
  const session = await getSession();
  const state = await getPostLikeState(
    parsed.data.postId,
    session?.user.id ?? null,
  );
  if (!state) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json(state);
}
