import { describe, expect, it } from "vitest";
import {
  CollaboratorRole,
  includesAccess,
  PostAccess,
  postAccessLevel,
  revokesEditAccess,
} from "./permissions";

const owner = "owner";
const actor = (role: string, id = "someone", bannedAt: Date | null = null) => ({
  id,
  role,
  bannedAt,
});

describe("postAccessLevel", () => {
  it.each([
    ["owner author", actor("author", owner), null, PostAccess.Manage],
    ["admin", actor("admin"), null, PostAccess.Manage],
    [
      "admin who is also a member",
      actor("admin"),
      "reviewer",
      PostAccess.Manage,
    ],
    ["unassigned author", actor("author"), null, null],
    ["reviewer", actor("author"), "reviewer", PostAccess.Read],
    ["editor", actor("author"), "editor", PostAccess.Edit],
    ["editor demoted to reader", actor("reader"), "editor", null],
    ["banned editor", actor("author", "someone", new Date()), "editor", null],
    ["banned owner", actor("author", owner, new Date()), null, null],
  ] as const)("%s", (_label, user, membership, expected) => {
    expect(postAccessLevel(user, owner, membership)).toBe(expected);
  });
});

describe("includesAccess", () => {
  it.each([
    [PostAccess.Manage, PostAccess.Manage, true],
    [PostAccess.Manage, PostAccess.Read, true],
    [PostAccess.Edit, PostAccess.Edit, true],
    [PostAccess.Edit, PostAccess.Read, true],
    [PostAccess.Edit, PostAccess.Manage, false],
    [PostAccess.Read, PostAccess.Read, true],
    [PostAccess.Read, PostAccess.Edit, false],
    [null, PostAccess.Read, false],
  ] as const)("%s includes %s: %s", (level, required, expected) => {
    expect(includesAccess(level, required)).toBe(expected);
  });
});

describe("revokesEditAccess", () => {
  it.each([
    [CollaboratorRole.Editor, null, true],
    [CollaboratorRole.Editor, CollaboratorRole.Reviewer, true],
    [CollaboratorRole.Editor, CollaboratorRole.Editor, false],
    [CollaboratorRole.Reviewer, null, false],
    [CollaboratorRole.Reviewer, CollaboratorRole.Editor, false],
    [null, CollaboratorRole.Editor, false],
    [null, CollaboratorRole.Reviewer, false],
  ] as const)("%s -> %s: %s", (from, to, expected) => {
    expect(revokesEditAccess(from, to)).toBe(expected);
  });
});
