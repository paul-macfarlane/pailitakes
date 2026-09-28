import { Action, canPerformAction } from "@/lib/auth/permissions";

// Client-safe: the edit/preview pages and the sharing UI branch on these
// without importing the server-only membership queries (ADR-0037).
export const CollaboratorRole = {
  Reviewer: "reviewer",
  Editor: "editor",
} as const;
export type CollaboratorRole =
  (typeof CollaboratorRole)[keyof typeof CollaboratorRole];
export const COLLABORATOR_ROLES = [
  CollaboratorRole.Reviewer,
  CollaboratorRole.Editor,
] as const;
export const COLLABORATOR_ROLE_LABELS: Record<CollaboratorRole, string> = {
  [CollaboratorRole.Reviewer]: "Reviewer",
  [CollaboratorRole.Editor]: "Editor",
};

// Ordered: each level includes every lower one. Manage (owner/admin) keeps
// lifecycle, publication, review decisions and collaborator management.
export const PostAccess = {
  Read: "read",
  Edit: "edit",
  Manage: "manage",
} as const;
export type PostAccess = (typeof PostAccess)[keyof typeof PostAccess];
const ACCESS_RANK: Record<PostAccess, number> = {
  [PostAccess.Read]: 1,
  [PostAccess.Edit]: 2,
  [PostAccess.Manage]: 3,
};
const ROLE_ACCESS: Record<CollaboratorRole, PostAccess> = {
  [CollaboratorRole.Reviewer]: PostAccess.Read,
  [CollaboratorRole.Editor]: PostAccess.Edit,
};

export type PostActor = {
  id: string;
  role?: string | null;
  bannedAt?: Date | null;
};

// The staff capability check comes first, so a membership row grants nothing
// once its user is demoted to reader or banned.
export function postAccessLevel(
  actor: PostActor,
  authorId: string,
  membership: CollaboratorRole | null,
): PostAccess | null {
  if (!canPerformAction(actor, Action.EditPost)) return null;
  if (actor.id === authorId || canPerformAction(actor, Action.ManageAnyPost))
    return PostAccess.Manage;
  return membership ? ROLE_ACCESS[membership] : null;
}

export function includesAccess(
  level: PostAccess | null,
  required: PostAccess,
): boolean {
  return level !== null && ACCESS_RANK[level] >= ACCESS_RANK[required];
}

// A save authorized before an Editor lost write access must not commit after
// it; rotating editVersion makes the existing save CAS reject it. Grants and
// Reviewer changes skip the rotation so they don't stale open editor tabs
// and reviews for nothing.
export function revokesEditAccess(
  from: CollaboratorRole | null,
  to: CollaboratorRole | null,
): boolean {
  return from === CollaboratorRole.Editor && to !== CollaboratorRole.Editor;
}
