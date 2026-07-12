import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-handler wiring test (mirrors src/app/api/cron/revalidate/route.test.ts):
// mock the service the route delegates to, and cover 400/404/200. Session is
// mocked too (same pattern as src/actions/comments.test.ts) so the route's
// getSession() call never touches the real Better Auth instance (which
// requires env vars this isolated run doesn't set).
const loadCommentThreadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/comments/service/read", () => ({
  loadCommentThread: loadCommentThreadMock,
}));

const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
}));

const { GET } = await import("./route");

function request(postId?: string) {
  const url = new URL("http://localhost/api/comments");
  if (postId !== undefined) url.searchParams.set("postId", postId);
  return new Request(url);
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/comments", () => {
  beforeEach(() => {
    sessionMock.current = null;
  });

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

  it("200s with the thread shape on success, passing viewerId=null for a signed-out request", async () => {
    const thread = {
      meta: { commentsLocked: false },
      comments: [],
    };
    loadCommentThreadMock.mockResolvedValue({ ok: true, thread });
    const res = await GET(request(VALID_UUID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(thread);
    expect(loadCommentThreadMock).toHaveBeenCalledWith(VALID_UUID, null);
  });

  it("passes the signed-in session's user id as viewerId", async () => {
    sessionMock.current = { user: { id: "user-1" } };
    loadCommentThreadMock.mockResolvedValue({
      ok: true,
      thread: { meta: { commentsLocked: false }, comments: [] },
    });
    await GET(request(VALID_UUID));
    expect(loadCommentThreadMock).toHaveBeenCalledWith(VALID_UUID, "user-1");
  });
});
