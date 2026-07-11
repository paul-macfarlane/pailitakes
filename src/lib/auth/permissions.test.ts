import { describe, expect, it } from "vitest";

import { Action, canPerformAction, rolesWithAction } from "./permissions";

type User = { role?: string | null; bannedAt?: Date | null };

const reader: User = { role: "reader", bannedAt: null };
const author: User = { role: "author", bannedAt: null };
const admin: User = { role: "admin", bannedAt: null };
const bannedAuthor: User = { role: "author", bannedAt: new Date() };
const bannedAdmin: User = { role: "admin", bannedAt: new Date() };
const undefinedRole: User = { bannedAt: null };
const nullRole: User = { role: null, bannedAt: null };

describe("canPerformAction", () => {
  it.each([
    // Reader: no actions.
    ["reader", reader, Action.CreatePost, false],
    ["reader", reader, Action.EditPost, false],
    ["reader", reader, Action.ManageAnyPost, false],
    ["reader", reader, Action.DeletePost, false],
    ["reader", reader, Action.PublishPost, false],
    ["reader", reader, Action.PreviewPost, false],
    ["reader", reader, Action.AccessAdmin, false],
    ["reader", reader, Action.ManageUsers, false],
    ["reader", reader, Action.ManageCategories, false],

    // Author: create/edit/publish/preview/access-admin, but not the
    // admin-only ownership bypass, delete, user management, or category
    // management (FR-2.1: categories are admin-managed).
    ["author", author, Action.CreatePost, true],
    ["author", author, Action.EditPost, true],
    ["author", author, Action.ManageAnyPost, false],
    ["author", author, Action.DeletePost, false],
    ["author", author, Action.PublishPost, true],
    ["author", author, Action.PreviewPost, true],
    ["author", author, Action.AccessAdmin, true],
    ["author", author, Action.ManageUsers, false],
    ["author", author, Action.ManageCategories, false],

    // Admin: everything.
    ["admin", admin, Action.CreatePost, true],
    ["admin", admin, Action.EditPost, true],
    ["admin", admin, Action.ManageAnyPost, true],
    ["admin", admin, Action.DeletePost, true],
    ["admin", admin, Action.PublishPost, true],
    ["admin", admin, Action.PreviewPost, true],
    ["admin", admin, Action.AccessAdmin, true],
    ["admin", admin, Action.ManageUsers, true],
    ["admin", admin, Action.ManageCategories, true],

    // Banned staff lose access immediately, regardless of role or action.
    ["banned author", bannedAuthor, Action.CreatePost, false],
    ["banned author", bannedAuthor, Action.EditPost, false],
    ["banned author", bannedAuthor, Action.PublishPost, false],
    ["banned author", bannedAuthor, Action.PreviewPost, false],
    ["banned author", bannedAuthor, Action.AccessAdmin, false],
    ["banned admin", bannedAdmin, Action.CreatePost, false],
    ["banned admin", bannedAdmin, Action.ManageAnyPost, false],
    ["banned admin", bannedAdmin, Action.DeletePost, false],
    ["banned admin", bannedAdmin, Action.AccessAdmin, false],
    ["banned admin", bannedAdmin, Action.ManageUsers, false],

    // Missing/unknown role: never grants anything.
    ["undefined role", undefinedRole, Action.CreatePost, false],
    ["undefined role", undefinedRole, Action.AccessAdmin, false],
    ["null role", nullRole, Action.CreatePost, false],
    ["null role", nullRole, Action.AccessAdmin, false],
  ])("%s -> %s: %s", (_label, user, action, expected) => {
    expect(canPerformAction(user, action)).toBe(expected);
  });
});

describe("rolesWithAction", () => {
  it("returns author and admin for AccessAdmin", () => {
    expect(rolesWithAction(Action.AccessAdmin).sort()).toEqual([
      "admin",
      "author",
    ]);
  });

  it("returns only admin for ManageUsers", () => {
    expect(rolesWithAction(Action.ManageUsers)).toEqual(["admin"]);
  });

  it("returns only admin for ManageAnyPost", () => {
    expect(rolesWithAction(Action.ManageAnyPost)).toEqual(["admin"]);
  });

  it("returns only admin for ManageCategories", () => {
    expect(rolesWithAction(Action.ManageCategories)).toEqual(["admin"]);
  });
});
