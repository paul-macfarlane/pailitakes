// Client-safe role values + label (no schema/server-only import, so the
// user-management client island can use them). ROLE_VALUES is guarded against
// drift from the pg `user_role` enum by src/lib/roles.test.ts — the same
// pattern as POST_STATUSES.
export const Role = {
  Reader: "reader",
  Author: "author",
  Admin: "admin",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLE_VALUES = [Role.Reader, Role.Author, Role.Admin] as const;

export function roleLabel(role: Role): string {
  return role[0]!.toUpperCase() + role.slice(1);
}
