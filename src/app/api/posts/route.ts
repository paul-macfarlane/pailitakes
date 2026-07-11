import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCategoryFeed,
  getHomeFeed,
  getTagFeed,
  HOME_PAGE_SIZE,
} from "@/lib/posts/home-feed";
import { slugParamSchema } from "@/lib/posts/input";

// Offset must be a page boundary: every distinct value mints its own cache
// entry (with background revalidation), so free-form offsets would let one
// cheap unauthenticated loop create thousands of entries and queries.
// Legitimate load-more traffic only ever sends multiples of the page size.
const querySchema = z
  .object({
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(HOME_PAGE_SIZE * 100)
      .multipleOf(HOME_PAGE_SIZE)
      .default(0),
    // Load-more for /categories/[slug] and /tags/[slug] (SRCH-2) — mutually
    // exclusive, no page needs both.
    category: slugParamSchema.optional(),
    tag: slugParamSchema.optional(),
  })
  .refine((v) => !(v.category && v.tag), {
    message: "category and tag are mutually exclusive",
  });

// Home/category/tag feed pages for the load-more island. The data itself is
// cached and tagged `post-list` inside getHomeFeed/getCategoryFeed/getTagFeed;
// this handler just validates input and routes to the matching feed.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    offset: searchParams.get("offset") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    tag: searchParams.get("tag") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { offset, category, tag } = parsed.data;
  if (category) {
    return NextResponse.json(await getCategoryFeed(category, offset));
  }
  if (tag) {
    return NextResponse.json(await getTagFeed(tag, offset));
  }
  return NextResponse.json(await getHomeFeed(offset));
}
