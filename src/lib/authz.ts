import "server-only";

import { userRole } from "@/db/schema";

type Role = (typeof userRole.enumValues)[number];

// Staff = can access /admin/**: authors and admins who aren't banned.
// Single source of truth for the layout gate and per-action checks (ADM-3).
// Typed against the schema enum so a role rename fails compilation here.
const STAFF_ROLES: readonly Role[] = ["author", "admin"];

// `role` stays loose (string) because Better Auth's inferred session types
// additional fields as string, not the pg enum.
export function isStaff(user: {
  role?: string | null;
  bannedAt?: Date | null;
}): boolean {
  return STAFF_ROLES.some((role) => role === user.role) && !user.bannedAt;
}

// Admin = full control (user management, moderation, …). A banned admin is
// not treated as admin — same as isStaff. Used to gate /admin/users and the
// role/ban actions (ADM-10).
export function isAdmin(user: {
  role?: string | null;
  bannedAt?: Date | null;
}): boolean {
  return user.role === "admin" && !user.bannedAt;
}
