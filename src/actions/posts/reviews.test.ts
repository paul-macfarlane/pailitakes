import { eq } from "drizzle-orm";
import { user } from "@/db/schema";
import { describe, expect, it, vi } from "vitest";
import {
  editProposals,
  posts,
  reviewComments,
  reviewDrafts,
} from "@/db/schema";
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

const {
  startReview,
  saveReviewDraft,
  refreshReviewDraft,
  discardReviewDraft,
  submitReview,
  addReviewComment,
  setThreadResolved,
} = await import("./reviews");
const { setCollaborator, requestReview } = await import("./collaborators");
const { applyProposal, getProposal, rejectProposal } =
  await import("./proposals");
const { updatePost } = await import("./crud");
const { getEditablePost } = await import("@/lib/posts/admin");
const { submitProposalService } = await import("@/lib/proposals/service");
const { getReviewWorkspaceService, getReviewTargetService } =
  await import("@/lib/reviews/service");
const { getCollaboratorsService, sharedPostsService } =
  await import("@/lib/collaboration/service");
const { reviewStatusesByPost } = await import("@/lib/reviews/status");

let ids: StaffFixtureIds;
const { authorSession, adminSession } = sessionSetters(sessionMock, () => ids);
const { runId } = registerPostSuiteLifecycle({
  testDb,
  pool,
  prefix: "t-review-",
  onSeeded: (value) => {
    ids = value;
  },
});
const { reviewer: reviewerId, other: otherId } = registerExtraAuthors(
  testDb,
  runId,
  ["reviewer", "other"],
);

const as = (id: string) => {
  sessionMock.current = sessionUser(id, "author");
  return { user: sessionUser(id, "author").user };
};
const BODY = "The Bears won big.\n\nTeh defense was great.\n";
const range = (text: string) => ({
  start: BODY.indexOf(text),
  end: BODY.indexOf(text) + text.length,
});
let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

async function seed(
  suffix: string,
  share: string[] = [reviewerId],
  published = false,
) {
  const post = await seedPost(testDb, {
    runId,
    suffix,
    authorId: ids.authorId,
    categoryId: ids.categoryId,
    bodyMd: BODY,
    ...(published
      ? {
          status: "published" as const,
          publishAt: new Date(Date.now() - 60000),
          thumbnailUrl: "https://example.com/thumb.png",
        }
      : {}),
  });
  authorSession();
  for (const userId of share)
    expect(
      await setCollaborator({ postId: post.id, userId, role: "reviewer" }),
    ).toMatchObject({ ok: true });
  return post;
}
const typo = () => ({
  id: uuid(),
  ...range("Teh"),
  before: "Teh",
  after: "The",
  correction: true,
  explanation: "",
});
const score = () => ({
  id: uuid(),
  ...range("won big"),
  before: "won big",
  after: "won 31-10",
  correction: false,
  explanation: "Use the real score.",
});

// Starts (or continues) the reviewer's draft and saves the given content.
async function draft(
  postId: string,
  content: {
    suggestions?: ReturnType<typeof typo>[];
    comments?: {
      id: string;
      start: number;
      end: number;
      quote: string;
      body: string;
    }[];
    generalFeedback?: string;
    metadata?: {
      field: string;
      after: unknown;
      correction: boolean;
      explanation: string;
    }[];
  },
  who = reviewerId,
) {
  as(who);
  expect(await startReview({ postId, replacesProposalId: null })).toMatchObject(
    { ok: true },
  );
  const workspace = await getReviewWorkspaceService(as(who).user, postId);
  as(who);
  const saved = await saveReviewDraft({
    postId,
    revision: workspace!.draft.revision,
    suggestions: content.suggestions ?? [],
    comments: content.comments ?? [],
    metadata: content.metadata ?? [],
    generalFeedback: content.generalFeedback ?? "",
  });
  expect(saved).toMatchObject({ ok: true });
  return saved.ok ? saved.data.revision : -1;
}
async function submit(
  postId: string,
  revision: number,
  acceptOutdated = false,
  who = reviewerId,
) {
  as(who);
  return submitReview({ postId, revision, acceptOutdated });
}
async function proposalRow(id: string) {
  return (
    await testDb.select().from(editProposals).where(eq(editProposals.id, id))
  )[0]!;
}

describe("human reviews (FR-7.15)", () => {
  it("reviewer drafts, submits; owner selectively applies one suggestion", async () => {
    const post = await seed("happy");
    const revision = await draft(post.id, {
      suggestions: [typo(), score()],
      comments: [
        {
          id: uuid(),
          ...range("defense"),
          quote: "defense",
          body: "Name a player?",
        },
      ],
      generalFeedback: "Fun read.",
    });
    const submitted = await submit(post.id, revision);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const row = await proposalRow(submitted.data.proposalId);
    expect(row).toMatchObject({
      origin: "human",
      reviewerId,
      reviewerName: `reviewer ${runId}`,
      agentId: null,
      skill: null,
      status: "open",
    });
    expect(row.notes.summary).toBe("Fun read.");
    expect(row.notes.changes?.map((c) => c.explanation)).toEqual([
      "Use the real score.",
      "Typo or formatting correction.",
    ]);
    const comments = await testDb
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.proposalId, row.id));
    expect(comments).toMatchObject([
      {
        anchor: { quote: "defense" },
        authorId: reviewerId,
        body: "Name a player?",
      },
    ]);
    expect(
      await testDb
        .select()
        .from(reviewDrafts)
        .where(eq(reviewDrafts.postId, post.id)),
    ).toEqual([]);

    as(reviewerId);
    expect(
      await applyProposal({
        proposalId: row.id,
        selectedChangeIds: ["body:1"],
      }),
    ).toMatchObject({ ok: false });
    authorSession();
    expect(
      await applyProposal({
        proposalId: row.id,
        selectedChangeIds: ["body:1"],
      }),
    ).toMatchObject({ ok: true });
    const [saved] = await testDb
      .select({ bodyMd: posts.bodyMd })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(saved!.bodyMd).toBe(
      "The Bears won big.\n\nThe defense was great.\n",
    );
  });

  it("owners and unshared authors cannot review; revoking deletes the draft", async () => {
    const post = await seed("gates");
    authorSession();
    expect(
      await startReview({ postId: post.id, replacesProposalId: null }),
    ).toMatchObject({ ok: false });
    as(otherId);
    expect(
      await startReview({ postId: post.id, replacesProposalId: null }),
    ).toMatchObject({ ok: false });

    const revision = await draft(post.id, { generalFeedback: "Draft note." });
    authorSession();
    await setCollaborator({ postId: post.id, userId: reviewerId, role: null });
    expect(
      await getReviewWorkspaceService(as(reviewerId).user, post.id),
    ).toBeNull();
    expect(await submit(post.id, revision)).toMatchObject({ ok: false });
  });

  it("an admin who doesn't own the post can review it", async () => {
    const post = await seed("admin", []);
    adminSession();
    expect(
      await startReview({ postId: post.id, replacesProposalId: null }),
    ).toMatchObject({ ok: true });
  });

  it("rejects stale draft revisions, moved anchors and empty submissions", async () => {
    const post = await seed("draft-guards");
    const revision = await draft(post.id, {});
    as(reviewerId);
    expect(
      await saveReviewDraft({
        postId: post.id,
        revision: revision - 1,
        suggestions: [],
        comments: [],
        metadata: [],
        generalFeedback: "Late tab.",
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await saveReviewDraft({
        postId: post.id,
        revision,
        suggestions: [{ ...typo(), start: 0, end: 3 }],
        comments: [],
        metadata: [],
        generalFeedback: "",
      }),
    ).toMatchObject({ ok: false });
    expect(await submit(post.id, revision)).toMatchObject({
      ok: false,
      error: "Add a suggestion or some feedback before submitting.",
    });
  });

  it("feedback-only reviews submit with no changes", async () => {
    const post = await seed("feedback-only");
    const revision = await draft(post.id, { generalFeedback: "Looks great." });
    const submitted = await submit(post.id, revision);
    expect(submitted.ok).toBe(true);
    if (submitted.ok)
      expect(
        (await proposalRow(submitted.data.proposalId)).diff.changes,
      ).toEqual([]);
  });

  it("multiple human reviews coexist with the one open AI review", async () => {
    const post = await seed("cardinality", [reviewerId, otherId]);
    const loaded = await getEditablePost(post.id, {
      id: ids.adminId,
      role: "admin",
    });
    const ai = await submitProposalService(
      AGENT_FIXTURE,
      agentReviewInput(loaded!, "AI version.\n"),
    );
    expect(ai.ok).toBe(true);
    for (const who of [reviewerId, otherId]) {
      const revision = await draft(post.id, { suggestions: [typo()] }, who);
      expect(await submit(post.id, revision, false, who)).toMatchObject({
        ok: true,
      });
    }
    const open = await testDb
      .select({ origin: editProposals.origin })
      .from(editProposals)
      .where(eq(editProposals.postId, post.id));
    expect(open.map((row) => row.origin).sort()).toEqual([
      "agent",
      "human",
      "human",
    ]);
    // A second AI review still needs to supersede the first.
    const again = await submitProposalService(
      AGENT_FIXTURE,
      agentReviewInput(loaded!, "Another AI version.\n"),
    );
    expect(again).toMatchObject({ ok: false, code: "conflict" });
  });

  it("outdated reviews need confirmation, stay unapplicable, and update via guided re-add", async () => {
    const post = await seed("outdated");
    const revision = await draft(post.id, { suggestions: [typo()] });
    authorSession();
    expect(
      await updatePost(
        post.id,
        { bodyMd: `${BODY}Owner kept writing.\n` },
        await loadEditVersion(testDb, post.id),
      ),
    ).toMatchObject({ ok: true });

    expect(
      (await getReviewWorkspaceService(as(reviewerId).user, post.id))?.outdated,
    ).toBe(true);
    expect(await submit(post.id, revision)).toMatchObject({
      ok: false,
      code: "outdated",
    });
    const submitted = await submit(post.id, revision, true);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const oldId = submitted.data.proposalId;

    authorSession();
    expect(
      await applyProposal({ proposalId: oldId, selectedChangeIds: ["body:0"] }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await getProposal(oldId)).toMatchObject({
      ok: true,
      data: { stale: true, canUpdate: false },
    });
    as(reviewerId);
    expect(await getProposal(oldId)).toMatchObject({
      ok: true,
      data: { canUpdate: true, canDecide: false },
    });

    expect(
      await startReview({ postId: post.id, replacesProposalId: oldId }),
    ).toMatchObject({ ok: true });
    const workspace = await getReviewWorkspaceService(
      as(reviewerId).user,
      post.id,
    );
    expect(workspace?.outdated).toBe(false);
    expect(workspace?.draft.suggestions).toEqual([]);
    expect(workspace?.previous).toEqual([
      expect.objectContaining({
        before: "Teh",
        after: "The",
        stillMatches: true,
        range: range("Teh"),
      }),
    ]);
    as(reviewerId);
    const saved = await saveReviewDraft({
      postId: post.id,
      revision: workspace!.draft.revision,
      suggestions: [typo()],
      comments: [],
      metadata: [],
      generalFeedback: "",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const replacement = await submit(post.id, saved.data.revision);
    expect(replacement.ok).toBe(true);
    expect((await proposalRow(oldId)).status).toBe("superseded");
  });

  it("refreshing an in-progress draft keeps suggestions as guided re-adds", async () => {
    const post = await seed("refresh");
    const revision = await draft(post.id, {
      suggestions: [score()],
      comments: [
        { id: uuid(), ...range("defense"), quote: "defense", body: "Kept." },
        { id: uuid(), ...range("big"), quote: "big", body: "Moved." },
      ],
    });
    authorSession();
    await updatePost(
      post.id,
      { bodyMd: BODY.replace("won big", "won huge") },
      await loadEditVersion(testDb, post.id),
    );
    as(reviewerId);
    expect(
      await refreshReviewDraft({ postId: post.id, revision }),
    ).toMatchObject({ ok: true });
    const workspace = await getReviewWorkspaceService(
      as(reviewerId).user,
      post.id,
    );
    expect(workspace).toMatchObject({
      outdated: false,
      draft: {
        suggestions: [],
        comments: [{ quote: "defense", body: "Kept." }],
      },
      previous: [{ before: "won big", stillMatches: false }],
    });
    expect(workspace?.draft.generalFeedback).toContain("On “big”: Moved.");
    as(reviewerId);
    expect(await discardReviewDraft(post.id)).toMatchObject({ ok: true });
  });
});

describe("review discussion (FR-7.16)", () => {
  it("participants comment and reply; only owner/admin or the reviewer resolve", async () => {
    const post = await seed("discussion", [reviewerId, otherId]);
    const revision = await draft(post.id, { suggestions: [typo()] });
    const submitted = await submit(post.id, revision);
    if (!submitted.ok) throw new Error(submitted.error);
    const proposalId = submitted.data.proposalId;

    authorSession();
    const thread = await addReviewComment({
      proposalId,
      changeId: "body:0",
      parentId: null,
      body: "Good catch.",
    });
    expect(thread.ok).toBe(true);
    if (!thread.ok) return;
    as(otherId);
    expect(
      await addReviewComment({
        proposalId,
        changeId: null,
        parentId: thread.data.id,
        body: "Agreed.",
      }),
    ).toMatchObject({ ok: true });
    const reply = await addReviewComment({
      proposalId,
      changeId: null,
      parentId: thread.data.id,
      body: "Nested?",
    });
    if (!reply.ok) throw new Error(reply.error);
    expect(
      await addReviewComment({
        proposalId,
        changeId: null,
        parentId: reply.data.id,
        body: "Too deep.",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await addReviewComment({
        proposalId,
        changeId: "body:9",
        parentId: null,
        body: "Unknown change.",
      }),
    ).toMatchObject({ ok: false });

    // Another collaborator may discuss but not resolve.
    expect(
      await setThreadResolved({ commentId: thread.data.id, resolved: true }),
    ).toMatchObject({ ok: false });
    as(reviewerId);
    expect(
      await setThreadResolved({ commentId: thread.data.id, resolved: true }),
    ).toMatchObject({ ok: true });
    authorSession();
    expect(
      await setThreadResolved({ commentId: thread.data.id, resolved: false }),
    ).toMatchObject({ ok: true });

    // Revoked collaborators lose the discussion too.
    await setCollaborator({ postId: post.id, userId: otherId, role: null });
    as(otherId);
    expect(
      await addReviewComment({
        proposalId,
        changeId: null,
        parentId: null,
        body: "Still here?",
      }),
    ).toMatchObject({ ok: false });
    expect((await getProposal(proposalId)).ok).toBe(false);
  });
});

describe("review statuses (FR-7.16)", () => {
  it("requested → in progress → submitted, for owner, reviewer and sharing page", async () => {
    const post = await seed("status");
    as(reviewerId);
    expect(
      await requestReview({ postId: post.id, userId: reviewerId }),
    ).toMatchObject({ ok: false });
    authorSession();
    expect(
      await requestReview({ postId: post.id, userId: otherId }),
    ).toMatchObject({ ok: false });
    expect(
      await requestReview({ postId: post.id, userId: reviewerId }),
    ).toMatchObject({ ok: true });

    const statusFor = async () => ({
      owner: (await reviewStatusesByPost([post.id])).get(post.id),
      reviewer: (await sharedPostsService(as(reviewerId).user)).find(
        (row) => row.id === post.id,
      )?.reviewStatus,
      sharing: (await getCollaboratorsService(as(ids.authorId).user, post.id))
        ?.members[0]?.reviewStatus,
    });
    expect(await statusFor()).toEqual({
      owner: "requested",
      reviewer: "requested",
      sharing: "requested",
    });
    const revision = await draft(post.id, { generalFeedback: "Working." });
    expect((await statusFor()).owner).toBe("in_progress");
    await submit(post.id, revision);
    expect(await statusFor()).toEqual({
      owner: "submitted",
      reviewer: "submitted",
      sharing: "submitted",
    });
  });

  it("statuses drop requests and drafts once the reviewer is demoted", async () => {
    const post = await seed("status-demoted");
    authorSession();
    await requestReview({ postId: post.id, userId: reviewerId });
    await draft(post.id, { generalFeedback: "Half done." });
    expect((await reviewStatusesByPost([post.id])).get(post.id)).toBe(
      "in_progress",
    );
    await testDb
      .update(user)
      .set({ role: "reader" })
      .where(eq(user.id, reviewerId));
    try {
      expect((await reviewStatusesByPost([post.id])).get(post.id)).toBeNull();
    } finally {
      await testDb
        .update(user)
        .set({ role: "author" })
        .where(eq(user.id, reviewerId));
    }
  });
});

describe("human review edge cases", () => {
  it("collaborators can't reject a human review", async () => {
    const post = await seed("no-reject", [reviewerId, otherId]);
    const revision = await draft(post.id, { suggestions: [typo()] });
    const submitted = await submit(post.id, revision);
    if (!submitted.ok) throw new Error(submitted.error);
    for (const who of [reviewerId, otherId]) {
      as(who);
      expect(await rejectProposal(submitted.data.proposalId)).toMatchObject({
        ok: false,
      });
    }
    expect((await proposalRow(submitted.data.proposalId)).status).toBe("open");
  });

  it("a second Update review click continues the same update", async () => {
    const post = await seed("update-twice");
    const revision = await draft(post.id, { suggestions: [typo()] });
    authorSession();
    await updatePost(
      post.id,
      { bodyMd: `${BODY}More.\n` },
      await loadEditVersion(testDb, post.id),
    );
    const submitted = await submit(post.id, revision, true);
    if (!submitted.ok) throw new Error(submitted.error);
    as(reviewerId);
    const again = {
      postId: post.id,
      replacesProposalId: submitted.data.proposalId,
    };
    expect(await startReview(again)).toMatchObject({ ok: true });
    expect(await startReview(again)).toMatchObject({ ok: true });
  });

  it("refresh refuses rather than truncating moved comments", async () => {
    const post = await seed("refresh-overflow");
    const revision = await draft(post.id, {
      comments: [
        { id: uuid(), ...range("big"), quote: "big", body: "x".repeat(300) },
      ],
      generalFeedback: "y".repeat(3900),
    });
    authorSession();
    await updatePost(
      post.id,
      { bodyMd: BODY.replace("won big", "won huge") },
      await loadEditVersion(testDb, post.id),
    );
    as(reviewerId);
    expect(
      await refreshReviewDraft({ postId: post.id, revision }),
    ).toMatchObject({ ok: false });
    const workspace = await getReviewWorkspaceService(
      as(reviewerId).user,
      post.id,
    );
    expect(workspace?.draft.comments).toHaveLength(1);
  });

  it("detail suggestions submit, validate and apply selectively", async () => {
    const post = await seed("details");
    as(reviewerId);
    await startReview({ postId: post.id, replacesProposalId: null });
    const workspace = await getReviewWorkspaceService(
      as(reviewerId).user,
      post.id,
    );
    as(reviewerId);
    expect(
      await saveReviewDraft({
        postId: post.id,
        revision: workspace!.draft.revision,
        suggestions: [],
        comments: [],
        metadata: [
          {
            field: "slug",
            after: "Not A Slug!",
            correction: false,
            explanation: "x",
          },
        ],
        generalFeedback: "",
      }),
    ).toMatchObject({ ok: false });
    const revision = await draft(post.id, {
      metadata: [
        {
          field: "title",
          after: "Bears roll",
          correction: false,
          explanation: "Punchier.",
        },
        { field: "tags", after: ["bears"], correction: true, explanation: "" },
      ],
    });
    const submitted = await submit(post.id, revision);
    if (!submitted.ok) throw new Error(submitted.error);
    const row = await proposalRow(submitted.data.proposalId);
    expect(row.diff.changes.map((c) => c.id)).toEqual([
      "field:title",
      "field:tags",
    ]);
    authorSession();
    expect(
      await applyProposal({
        proposalId: row.id,
        selectedChangeIds: ["field:title"],
      }),
    ).toMatchObject({ ok: true });
    const [saved] = await testDb
      .select({ title: posts.title })
      .from(posts)
      .where(eq(posts.id, post.id));
    expect(saved!.title).toBe("Bears roll");
  });

  it("a slug already taken by another post is refused at submit", async () => {
    const taken = await seed("slug-taken", []);
    const post = await seed("slug-clash");
    const revision = await draft(post.id, {
      metadata: [
        {
          field: "slug",
          after: taken.slug,
          correction: false,
          explanation: "Match.",
        },
      ],
    });
    expect(await submit(post.id, revision)).toMatchObject({
      ok: false,
      error: "That slug is taken.",
    });
  });
});

describe("editing a submitted review (Paul, September 28)", () => {
  async function submitted(suffix: string) {
    const post = await seed(suffix);
    const revision = await draft(post.id, {
      suggestions: [typo()],
      comments: [
        { id: uuid(), ...range("defense"), quote: "defense", body: "Who?" },
      ],
      metadata: [
        {
          field: "title",
          after: "Bears roll",
          correction: false,
          explanation: "Punchier.",
        },
      ],
      generalFeedback: "First pass.",
    });
    const result = await submit(post.id, revision);
    if (!result.ok) throw new Error(result.error);
    return { post, proposalId: result.data.proposalId };
  }

  it("reopens the review as a pre-filled draft; resubmitting replaces it", async () => {
    const { post, proposalId } = await submitted("edit-fresh");
    as(reviewerId);
    expect(await getProposal(proposalId)).toMatchObject({
      ok: true,
      data: { stale: false, canUpdate: true },
    });
    expect(
      await startReview({ postId: post.id, replacesProposalId: proposalId }),
    ).toMatchObject({ ok: true });
    const workspace = await getReviewWorkspaceService(
      as(reviewerId).user,
      post.id,
    );
    expect(workspace).toMatchObject({
      outdated: false,
      previous: [],
      draft: {
        replacesProposalId: proposalId,
        generalFeedback: "First pass.",
        suggestions: [{ before: "Teh", after: "The", correction: true }],
        comments: [{ quote: "defense", body: "Who?" }],
        metadata: [{ field: "title", after: "Bears roll" }],
      },
    });
    // Still live for the owner while the reviewer edits.
    expect((await proposalRow(proposalId)).status).toBe("open");

    as(reviewerId);
    const saved = await saveReviewDraft({
      postId: post.id,
      revision: workspace!.draft.revision,
      suggestions: workspace!.draft.suggestions,
      comments: workspace!.draft.comments,
      metadata: [],
      generalFeedback: "Second pass.",
    });
    if (!saved.ok) throw new Error(saved.error);
    const resubmitted = await submit(post.id, saved.data.revision);
    if (!resubmitted.ok) throw new Error(resubmitted.error);
    expect((await proposalRow(proposalId)).status).toBe("superseded");
    const replacement = await proposalRow(resubmitted.data.proposalId);
    expect(replacement).toMatchObject({ status: "open" });
    expect(replacement.notes.summary).toBe("Second pass.");

    // The replaced version can never be applied afterwards.
    authorSession();
    expect(
      await applyProposal({ proposalId, selectedChangeIds: ["body:0"] }),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("if the owner applies the old version mid-edit, the edit arrives as a new outdated review", async () => {
    const { post, proposalId } = await submitted("edit-race");
    as(reviewerId);
    await startReview({ postId: post.id, replacesProposalId: proposalId });
    authorSession();
    expect(
      await applyProposal({ proposalId, selectedChangeIds: ["body:0"] }),
    ).toMatchObject({ ok: true });

    const workspace = await getReviewWorkspaceService(
      as(reviewerId).user,
      post.id,
    );
    expect(workspace?.outdated).toBe(true);
    expect(await submit(post.id, workspace!.draft.revision)).toMatchObject({
      ok: false,
      code: "outdated",
    });
    const resubmitted = await submit(post.id, workspace!.draft.revision, true);
    if (!resubmitted.ok) throw new Error(resubmitted.error);
    expect((await proposalRow(proposalId)).status).toBe("applied");
    authorSession();
    expect(
      await applyProposal({
        proposalId: resubmitted.data.proposalId,
        selectedChangeIds: ["body:0"],
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("discarding an edit leaves the submitted version untouched", async () => {
    const { post, proposalId } = await submitted("edit-discard");
    as(reviewerId);
    await startReview({ postId: post.id, replacesProposalId: proposalId });
    expect(await discardReviewDraft(post.id)).toMatchObject({ ok: true });
    expect((await proposalRow(proposalId)).status).toBe("open");
    expect(await getReviewTargetService(as(reviewerId).user, post.id)).toEqual({
      title: `${runId} edit-discard`,
      ownReviewId: proposalId,
    });
  });

  it("no one can edit another reviewer's review", async () => {
    const { post, proposalId } = await submitted("edit-other");
    authorSession();
    await setCollaborator({
      postId: post.id,
      userId: otherId,
      role: "reviewer",
    });
    as(otherId);
    expect(
      await startReview({ postId: post.id, replacesProposalId: proposalId }),
    ).toMatchObject({ ok: false });
    expect(
      await getReviewWorkspaceService(as(otherId).user, post.id),
    ).toBeNull();
  });
});

describe("submit-time detail checks", () => {
  it("a current review can't remove a public post's thumbnail", async () => {
    const post = await seed("public-thumb", [reviewerId], true);
    const revision = await draft(post.id, {
      metadata: [
        {
          field: "thumbnailUrl",
          after: "",
          correction: false,
          explanation: "Drop it.",
        },
      ],
    });
    expect(await submit(post.id, revision)).toMatchObject({
      ok: false,
      error: "A published or scheduled post must keep its thumbnail.",
    });
  });

  it("an outdated review isn't refused over details the reviewer never touched", async () => {
    // Started while the draft had no thumbnail; the owner then published.
    const post = await seed("outdated-published");
    const revision = await draft(post.id, { generalFeedback: "Nice." });
    await testDb
      .update(posts)
      .set({
        status: "published",
        publishAt: new Date(Date.now() - 60000),
        thumbnailUrl: "https://example.com/thumb.png",
        editVersion: crypto.randomUUID(),
      })
      .where(eq(posts.id, post.id));
    expect(await submit(post.id, revision, true)).toMatchObject({ ok: true });
  });
});
