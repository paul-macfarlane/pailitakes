import { expect, test } from "@playwright/test";

// Pre-compiles every route the suite touches (see the warmup project in
// playwright.config.ts). `next dev` compiles routes on first hit; done
// serially here, each compile gets the whole CPU instead of racing five
// workers, and the parallel suite then only ever sees warm routes.
//
// Paths that need a param use a bogus value on purpose: a 404/redirect
// still compiles the route module, and needs no fixture rows.
const ROUTES = [
  "/",
  "/sign-in",
  "/account",
  "/privacy",
  "/terms",
  "/posts/warmup-nonexistent-slug",
  "/tags/warmup-nonexistent-tag",
  "/api/comments?postId=00000000-0000-0000-0000-000000000000",
  "/admin",
  "/admin/posts/new",
  "/admin/posts/00000000-0000-0000-0000-000000000000/edit",
  "/admin/preview/00000000-0000-0000-0000-000000000000",
  "/admin/users",
  "/admin/moderation",
  "/admin/categories",
  "/admin/announcements",
  "/admin/analytics",
];

test("warm every route before the parallel suite", async ({ request }) => {
  test.setTimeout(180_000);
  for (const path of ROUTES) {
    // Any completed response proves the route compiled — status is
    // irrelevant (signed-out admin hits redirect, bogus params 404).
    const response = await request.get(path, { timeout: 60_000 });
    expect(response.status(), path).toBeLessThan(600);
  }
});
