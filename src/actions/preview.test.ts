import { describe, expect, it, vi } from "vitest";

import { sessionSetters } from "@/test/helpers";

// preview.ts imports only markdown + session (no @/db), so — unlike the
// posts action test files — this file needs no DB harness, just the same
// settable fake session mock.
const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
}));

const { renderPostPreview } = await import("./preview");

// No DB fixtures here, so sessionSetters falls back to its default static
// "user-1" ids for all three roles.
const { authorSession, adminSession, readerSession, noSession } =
  sessionSetters(sessionMock);

describe("renderPostPreview", () => {
  it("rejects an unauthenticated caller", async () => {
    noSession();
    const result = await renderPostPreview({ bodyMd: "# Hi" });
    expect(result).toEqual({ ok: false, error: "Not authorized." });
  });

  it("rejects a reader", async () => {
    readerSession();
    const result = await renderPostPreview({ bodyMd: "# Hi" });
    expect(result).toEqual({ ok: false, error: "Not authorized." });
  });

  it("renders markdown through the production pipeline for staff", async () => {
    authorSession();
    const result = await renderPostPreview({
      bodyMd: "# Hi\n\nSome paragraph.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toContain("<h1>Hi</h1>");
    expect(result.data.html).toContain("<p>Some paragraph.</p>");
  });

  it("sanitizes script tags", async () => {
    adminSession();
    const result = await renderPostPreview({
      bodyMd: "<script>alert(1)</script>\n\nHello",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).not.toContain("<script");
    expect(result.data.html).toContain("Hello");
  });

  it("embeds a bare YouTube link as the lite-youtube facade", async () => {
    authorSession();
    const result = await renderPostPreview({
      bodyMd: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toContain(
      '<lite-youtube class="youtube-embed" videoid="dQw4w9WgXcQ"',
    );
  });

  it("rejects an oversized body", async () => {
    authorSession();
    const result = await renderPostPreview({ bodyMd: "a".repeat(100_001) });
    expect(result.ok).toBe(false);
  });
});
