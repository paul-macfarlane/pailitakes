import { describe, expect, it, vi } from "vitest";

// Route-handler wiring test (mirrors src/app/api/cron/revalidate/route.test.ts):
// mock the service the route delegates to, and cover 400/404/200.
const loadCommentThreadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/comments/service/read", () => ({
  loadCommentThread: loadCommentThreadMock,
}));

const { GET } = await import("./route");

function request(postId?: string) {
  const url = new URL("http://localhost/api/comments");
  if (postId !== undefined) url.searchParams.set("postId", postId);
  return new Request(url);
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/comments", () => {
  it("400s a missing or invalid postId without calling the service", async () => {
    expect((await GET(request())).status).toBe(400);
    expect((await GET(request("not-a-uuid"))).status).toBe(400);
    expect(loadCommentThreadMock).not.toHaveBeenCalled();
  });

  it("404s when the post doesn't exist or isn't publicly visible", async () => {
    loadCommentThreadMock.mockResolvedValue({ ok: false, reason: "not-found" });
    const res = await GET(request(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("200s with the thread shape on success", async () => {
    const thread = {
      meta: { commentsLocked: false },
      comments: [],
    };
    loadCommentThreadMock.mockResolvedValue({ ok: true, thread });
    const res = await GET(request(VALID_UUID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(thread);
    expect(loadCommentThreadMock).toHaveBeenCalledWith(VALID_UUID);
  });
});
