import { describe, expect, it } from "vitest";

import { isStaff } from "./authz";

describe("isStaff", () => {
  it("allows an author", () => {
    expect(isStaff({ role: "author", bannedAt: null })).toBe(true);
  });

  it("allows an admin", () => {
    expect(isStaff({ role: "admin", bannedAt: null })).toBe(true);
  });

  it("rejects a reader", () => {
    expect(isStaff({ role: "reader", bannedAt: null })).toBe(false);
  });

  it("rejects an undefined role", () => {
    expect(isStaff({ bannedAt: null })).toBe(false);
  });

  it("rejects a null role", () => {
    expect(isStaff({ role: null, bannedAt: null })).toBe(false);
  });

  it("rejects a banned author", () => {
    expect(isStaff({ role: "author", bannedAt: new Date() })).toBe(false);
  });

  it("rejects a banned admin", () => {
    expect(isStaff({ role: "admin", bannedAt: new Date() })).toBe(false);
  });
});
