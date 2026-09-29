import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { posts } from "@/db/schema";
import {
  AGENT_FIXTURE,
  agentReviewInput,
  loadEditVersion,
  registerExtraAuthors,
  registerPostSuiteLifecycle,
  seedPost,
  sessionSetters,
  sessionUser,
  type StaffFixtureIds,
} from "@/test/helpers";
import { NOT_AUTHORIZED_ERROR } from "@/lib/shared/action-result";

const { pool, testDb } = await vi.hoisted(async () => {
  const { createTestDb } = await import("@/test/helpers");
  return createTestDb();
});
vi.mock("@/db", () => ({ db: testDb }));
const sessionMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => sessionMock.current,
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { setCollaborator } = await import("./collaborators");
const { updatePost, deletePost } = await import("./crud");
const { transitionPostStatus, schedulePublish } = await import("./lifecycle");
const { publishPostChanges, discardPostChanges } = await import("./draft");
const { listProposals, getProposal, applyProposal, rejectProposal } =
  await import("./proposals");
const { submitProposalService } = await import("@/lib/proposals/service");
const { getEditablePost, getPostForPreview } =
  await import("@/lib/posts/admin");
const { getCollaboratorsService, sharedPostsService } =
  await import("@/lib/collaboration/service");

let ids: StaffFixtureIds;
const { authorSession, adminSession, readerSession } = sessionSetters(
  sessionMock,
  () => ids,
);
const { runId } = registerPostSuiteLifecycle({
  testDb,
  pool,
  prefix: "t-collab-",
  onSeeded: (value) => {
    ids = value;
  },
});
// A second and third author: the collaborator and an unassigned bystander.
const { collab: collaboratorId, bystander: bystanderId } = registerExtraAuthors(
  testDb,
  runId,
  ["collab", "bystander"],
);

const as = (id: string, role: "author" | "admin" | "reader" = "author") => {
  sessionMock.current = sessionUser(id, role);
  return sessionUser(id, role).user;
};
const denied = { ok: false, error: expect.any(String) };
const unauthorized = { ok: false, error: NOT_AUTHORIZED_ERROR };
const notFound = { ok: false, error: "Proposal or post not found." };

async function seed(suffix: string, published = false) {
  return seedPost(testDb, {
    runId,
    suffix,
    authorId: ids.authorId,
    categoryId: ids.categoryId,
    thumbnailUrl: "https://example.com/thumb.png",
    status: published ? "published" : "draft",
    publishAt: published ? new Date(Date.now() - 60000) : null,
  });
}
async function propose(postId: string) {
  const loaded = await getEditablePost(postId, {
    id: ids.adminId,
    role: "admin",
  });
  const result = await submitProposalService(
    AGENT_FIXTURE,
    agentReviewInput(loaded!, "AI candidate."),
  );
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function share(postId: string, role: "reviewer" | "editor" | null) {
  authorSession();
  const result = await setCollaborator({
    postId,
    userId: collaboratorId,
    role,
  });
  expect(result).toEqual({ ok: true, data: { postId } });
}

describe("post-scoped collaborator access (FR-7.14)", () => {
  it("owner and admin manage sharing; collaborators and bystanders cannot", async () => {
    const post = await seed("manage");
    await share(post.id, "reviewer");

    as(collaboratorId);
    expect(
      await setCollaborator({
        postId: post.id,
        userId: bystanderId,
        role: "reviewer",
      }),
    ).toMatchObject(denied);
    as(bystanderId);
    expect(
      await setCollaborator({
        postId: post.id,
        userId: bystanderId,
        role: "editor",
      }),
    ).toMatchObject(denied);
    expect(
      await getCollaboratorsService(as(collaboratorId), post.id),
    ).toBeNull();

    adminSession();
    expect(
      await setCollaborator({
        postId: post.id,
        userId: collaboratorId,
        role: "editor",
      }),
    ).toMatchObject({ ok: true });
    const sharing = await getCollaboratorsService(as(ids.authorId), post.id);
    expect(sharing?.members).toEqual([
      {
        userId: collaboratorId,
        name: `collab ${runId}`,
        role: "editor",
        reviewStatus: null,
      },
    ]);
    expect(sharing?.options.map((o) => o.id)).not.toContain(ids.authorId);
    expect(sharing?.options.map((o) => o.id)).not.toContain(ids.readerId);
    expect(sharing?.options.map((o) => o.id)).not.toContain(ids.adminId);
  });

  it.each([
    ["the owner", () => ids.authorId, "already has full access"],
    ["a reader", () => ids.readerId, "active author"],
  ])("refuses to share with %s", async (_label, target, message) => {
    const post = await seed(`refuse-${target().slice(-6)}`);
    authorSession();
    const result = await setCollaborator({
      postId: post.id,
      userId: target(),
      role: "reviewer",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("rejects malformed input and non-staff before touching the post", async () => {
    const post = await seed("invalid");
    authorSession();
    expect(
      await setCollaborator({
        postId: post.id,
        userId: collaboratorId,
        role: "owner",
      }),
    ).toEqual({ ok: false, error: "Invalid collaborator." });
    readerSession();
    expect(
      await setCollaborator({
        postId: post.id,
        userId: collaboratorId,
        role: "reviewer",
      }),
    ).toMatchObject(denied);
  });

  it("Reviewer reads preview and reviews but cannot edit, publish or delete", async () => {
    const post = await seed("reviewer");
    const reviewer = as(collaboratorId);
    expect(await getPostForPreview(post.id, reviewer)).toBeNull();

    await share(post.id, "reviewer");
    expect((await getPostForPreview(post.id, reviewer))?.access).toBe("read");
    expect(await getEditablePost(post.id, reviewer)).toBeNull();
    as(collaboratorId);
    expect((await listProposals(post.id)).ok).toBe(true);
    const version = await loadEditVersion(testDb, post.id);
    expect(
      await updatePost(post.id, { bodyMd: "Reviewer edit." }, version),
    ).toMatchObject(denied);
    expect(await transitionPostStatus(post.id, "published")).toMatchObject(
      denied,
    );
    expect(await deletePost(post.id)).toMatchObject({ ok: false });
  });

  it("Editor saves through the version guard but cannot publish, delete or manage", async () => {
    const post = await seed("editor");
    await share(post.id, "editor");
    const editor = as(collaboratorId);
    const loaded = await getEditablePost(post.id, editor);
    expect(loaded?.access).toBe("edit");

    as(collaboratorId);
    const saved = await updatePost(
      post.id,
      { bodyMd: "Editor edit." },
      loaded!.editVersion,
    );
    expect(saved.ok).toBe(true);
    // The loaded token is now stale: no silent overwrite.
    expect(
      await updatePost(post.id, { bodyMd: "Stale edit." }, loaded!.editVersion),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await transitionPostStatus(post.id, "published")).toMatchObject(
      denied,
    );
    expect(await deletePost(post.id)).toMatchObject({ ok: false });
    expect(
      await setCollaborator({
        postId: post.id,
        userId: bystanderId,
        role: "reviewer",
      }),
    ).toMatchObject(denied);
  });

  it("unassigned authors see nothing, even with another post shared", async () => {
    const post = await seed("bystander");
    await share(post.id, "editor");
    const bystander = as(bystanderId);
    expect(await getPostForPreview(post.id, bystander)).toBeNull();
    expect(await getEditablePost(post.id, bystander)).toBeNull();
    as(bystanderId);
    expect((await listProposals(post.id)).ok).toBe(false);
    expect(
      (await sharedPostsService(bystander)).map((row) => row.id),
    ).not.toContain(post.id);
  });

  it("revoking an Editor rotates the edit version; grants and Reviewer changes do not", async () => {
    const post = await seed("rotation");
    const v0 = await loadEditVersion(testDb, post.id);
    await share(post.id, "reviewer");
    await share(post.id, "editor");
    expect(await loadEditVersion(testDb, post.id)).toBe(v0);

    await share(post.id, "reviewer");
    const v1 = await loadEditVersion(testDb, post.id);
    expect(v1).not.toBe(v0);
    await share(post.id, null);
    expect(await loadEditVersion(testDb, post.id)).toBe(v1);

    // A save authorized under the pre-revocation token cannot commit.
    authorSession();
    expect(
      await updatePost(post.id, { bodyMd: "Late save." }, v0),
    ).toMatchObject({ ok: false, code: "conflict" });
    const former = as(collaboratorId);
    expect(await getPostForPreview(post.id, former)).toBeNull();
  });

  it("Shared with me lists assigned posts and nothing after demotion", async () => {
    const post = await seed("shared-list");
    await share(post.id, "reviewer");
    const listed = await sharedPostsService(as(collaboratorId));
    expect(listed).toContainEqual(
      expect.objectContaining({ id: post.id, role: "reviewer" }),
    );
    expect(await sharedPostsService(as(collaboratorId, "reader"))).toEqual([]);
    expect(
      await getPostForPreview(post.id, as(collaboratorId, "reader")),
    ).toBeNull();
  });

  it.each(["reviewer", "editor"] as const)(
    "%s reads reviews but cannot decide them or run owner lifecycle actions",
    async (role) => {
      const post = await seed(`decide-${role}`, true);
      const proposal = await propose(post.id);
      await share(post.id, role);
      as(collaboratorId);
      const read = await getProposal(proposal.id);
      expect(read).toMatchObject({ ok: true, data: { canDecide: false } });
      const change = proposal.diff.changes[0]!.id;
      expect(
        await applyProposal({
          proposalId: proposal.id,
          selectedChangeIds: [change],
        }),
      ).toMatchObject(notFound);
      expect(await rejectProposal(proposal.id)).toMatchObject(notFound);
      // Exact errors: the ownership check must be what refuses, not a later
      // draft-state or conflict check.
      expect(await publishPostChanges(post.id)).toEqual(unauthorized);
      expect(await discardPostChanges(post.id)).toEqual(unauthorized);
      expect(
        await schedulePublish(post.id, new Date(Date.now() + 86400000)),
      ).toEqual(unauthorized);
      authorSession();
      expect(await getProposal(proposal.id)).toMatchObject({
        ok: true,
        data: { canDecide: true, proposal: { status: "open" } },
      });
    },
  );

  it("Editor edits to a public post stage privately for the owner to publish", async () => {
    const post = await seed("public-editor", true);
    await share(post.id, "editor");
    const editor = as(collaboratorId);
    const loaded = await getEditablePost(post.id, editor);
    as(collaboratorId);
    const saved = await updatePost(
      post.id,
      { bodyMd: "Staged by editor." },
      loaded!.editVersion,
    );
    expect(saved.ok).toBe(true);
    const owned = await getEditablePost(post.id, as(ids.authorId));
    expect(owned).toMatchObject({
      hasPendingChanges: true,
      bodyMd: "Staged by editor.",
    });
    const [live] = await testDb
      .select({ bodyMd: posts.bodyMd })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(live!.bodyMd).toBe("Body.");
  });
});
