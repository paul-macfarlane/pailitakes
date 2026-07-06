import { NextResponse } from "next/server";
import { z } from "zod";

import { getHomeFeed, HOME_PAGE_SIZE } from "@/lib/home-feed";

// Offset must be a page boundary: every distinct value mints its own cache
// entry (with background revalidation), so free-form offsets would let one
// cheap unauthenticated loop create thousands of entries and queries.
// Legitimate load-more traffic only ever sends multiples of the page size.
const querySchema = z.object({
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(HOME_PAGE_SIZE * 100)
    .multipleOf(HOME_PAGE_SIZE)
    .default(0),
});

// Home-feed pages for the load-more island. The data itself is cached and
// tagged `post-list` inside getHomeFeed; this handler just validates input.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    offset: searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }

  return NextResponse.json(await getHomeFeed(parsed.data.offset));
}
