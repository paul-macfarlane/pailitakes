import "server-only";

// Session gates shared by every server action (design §8, §9): assume
// hostile input on every call, never trust the client, and re-check session +
// role + ownership per action — middleware/UI gating is convenience only.

import { canPerformAction, type Action } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";

// One gate for every action-scoped server action: session-or-null, gated by
// canPerformAction (ADM-3). Ownership (author scoped to own rows, admin
// unscoped) is checked per action once the target row is loaded.
export async function actionSession(action: Action) {
  const session = await getSession();
  return session && canPerformAction(session.user, action) ? session : null;
}

// Type of a resolved action session, for data/service helpers (e.g.
// loadOwnedDraft, loadOwnedLifecycle) that need the caller's id/role to run
// an ownership check without importing actionSession just for its type.
export type StaffSession = NonNullable<
  Awaited<ReturnType<typeof actionSession>>
>;
