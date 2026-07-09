import { describe, expect, it } from "vitest";

import { userRole } from "@/db/schema";
import { ROLE_VALUES, roleLabel } from "@/lib/roles";

describe("ROLE_VALUES", () => {
  it("matches the user_role pg enum exactly (no drift)", () => {
    expect([...ROLE_VALUES].sort()).toEqual([...userRole.enumValues].sort());
  });
});

describe("roleLabel", () => {
  it("capitalizes the role", () => {
    expect(roleLabel("reader")).toBe("Reader");
    expect(roleLabel("author")).toBe("Author");
    expect(roleLabel("admin")).toBe("Admin");
  });
});
