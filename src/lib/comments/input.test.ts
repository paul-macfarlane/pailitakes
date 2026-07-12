import { describe, expect, it } from "vitest";

import {
  commentBodySchema,
  commentIdSchema,
  createCommentSchema,
  editCommentSchema,
  postIdSchema,
} from "@/lib/comments/input";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("commentBodySchema", () => {
  it("trims surrounding whitespace", () => {
    expect(commentBodySchema.parse("  hello  ")).toBe("hello");
  });

  it("rejects an empty (or whitespace-only) body", () => {
    expect(commentBodySchema.safeParse("").success).toBe(false);
    expect(commentBodySchema.safeParse("   ").success).toBe(false);
  });

  it("accepts a body at the 2000-char cap and rejects one over it", () => {
    expect(commentBodySchema.safeParse("a".repeat(2000)).success).toBe(true);
    expect(commentBodySchema.safeParse("a".repeat(2001)).success).toBe(false);
  });
});

describe("commentIdSchema / postIdSchema", () => {
  it("accepts a uuid and rejects a non-uuid", () => {
    expect(commentIdSchema.safeParse(VALID_UUID).success).toBe(true);
    expect(commentIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(postIdSchema.safeParse(VALID_UUID).success).toBe(true);
    expect(postIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("createCommentSchema", () => {
  it("accepts a top-level comment with parentId explicitly null", () => {
    const result = createCommentSchema.safeParse({
      postId: VALID_UUID,
      parentId: null,
      body: "Great take.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a reply with a uuid parentId", () => {
    const result = createCommentSchema.safeParse({
      postId: VALID_UUID,
      parentId: VALID_UUID,
      body: "Disagree.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing parentId key (explicit null, not absent, means top-level)", () => {
    const result = createCommentSchema.safeParse({
      postId: VALID_UUID,
      body: "Missing parentId key.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid postId or empty body", () => {
    expect(
      createCommentSchema.safeParse({
        postId: "bad",
        parentId: null,
        body: "x",
      }).success,
    ).toBe(false);
    expect(
      createCommentSchema.safeParse({
        postId: VALID_UUID,
        parentId: null,
        body: "",
      }).success,
    ).toBe(false);
  });
});

describe("editCommentSchema", () => {
  it("accepts a valid body", () => {
    expect(editCommentSchema.safeParse({ body: "Updated take." }).success).toBe(
      true,
    );
  });

  it("rejects an empty body", () => {
    expect(editCommentSchema.safeParse({ body: "" }).success).toBe(false);
  });
});
