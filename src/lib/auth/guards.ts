import "server-only";

// Session gates shared by every server action (design §8, §9): assume
// hostile input on every call, never trust the client, and re-check session +
// role + ownership per action — middleware/UI gating is convenience only.

import { isAdmin, isStaff } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";

// Staff-only gate shared by every staff action (authors + admins; §5.7).
// Ownership (author scoped to own rows, admin unscoped) is checked per
// action once the target row is loaded.
export async function staffSession() {
  const session = await getSession();
  return session && isStaff(session.user) ? session : null;
}

// Type of a resolved staff session, for data/service helpers (e.g.
// loadOwnedDraft, loadOwnedLifecycle) that need the caller's id/role to run
// an ownership check without importing staffSession just for its type.
export type StaffSession = NonNullable<
  Awaited<ReturnType<typeof staffSession>>
>;

// Admin-only gate shared by every admin action (user management, hard
// delete; ADM-10, §5.7).
export async function adminSession() {
  const session = await getSession();
  return session && isAdmin(session.user) ? session : null;
}
