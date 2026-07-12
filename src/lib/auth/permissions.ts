// Client-safe capability layer: ONE function (canPerformAction) driven by a
// roles->actions map, used for both server action gates (src/lib/auth/
// guards.ts) and page/UI gating (src/lib/auth/session.ts,
// src/components/header-auth.tsx). No `server-only`/schema import here — the
// pgEnum drift guard already lives in src/lib/auth/roles.test.ts, so
// coupling this file to src/db/schema would be redundant and would also
// block the client-side use in header-auth.tsx.

import { Role } from "@/lib/auth/roles";

export const Action = {
  CreatePost: "post.create",
  EditPost: "post.edit",
  // Ownership bypass: act on other authors' posts (admin-unscoped reads/
  // writes vs. an author scoped to author_id = self; §5.7).
  ManageAnyPost: "post.manage-any",
  DeletePost: "post.delete",
  // Draft promote/discard + lifecycle transitions + scheduling.
  PublishPost: "post.publish",
  PreviewPost: "post.preview",
  // View /admin pages, see the dashboard link.
  AccessAdmin: "admin.access",
  ManageUsers: "user.manage",
  // Admin-managed fixed list (FR-2.1) — authors get nothing.
  ManageCategories: "category.manage",
  // Admin-only site-wide messages (FR-6.1) — authors get nothing.
  ManageAnnouncements: "announcement.manage",
  // Any authenticated, non-banned reader may comment (FR-4.1) — CreateComment
  // is deliberately the widest-held action in this map.
  CreateComment: "comment.create",
  // Ownership bypass for comments (mirrors ManageAnyPost): admin delete-any +
  // lock (FR-4.4).
  ManageAnyComment: "comment.manage-any",
  // Moderation log access (design §5.2 "Moderation log (admin)").
  ModerateComments: "comment.moderate",
  // Any authenticated, non-banned user may like a post/comment (FR-5.1,
  // design §5.4) — same breadth as CreateComment, held separately so a
  // future split (e.g. likes-only suspension) doesn't need to touch comment
  // gating.
  LikeContent: "like_content",
} as const;
export type Action = (typeof Action)[keyof typeof Action];

const ROLE_ACTIONS: Record<Role, readonly Action[]> = {
  [Role.Reader]: [Action.CreateComment, Action.LikeContent],
  [Role.Author]: [
    Action.CreatePost,
    Action.EditPost,
    Action.PublishPost,
    Action.PreviewPost,
    Action.AccessAdmin,
    Action.CreateComment,
    Action.LikeContent,
  ],
  [Role.Admin]: [
    Action.CreatePost,
    Action.EditPost,
    Action.ManageAnyPost,
    Action.DeletePost,
    Action.PublishPost,
    Action.PreviewPost,
    Action.AccessAdmin,
    Action.ManageUsers,
    Action.ManageCategories,
    Action.ManageAnnouncements,
    Action.CreateComment,
    Action.ManageAnyComment,
    Action.ModerateComments,
    Action.LikeContent,
  ],
};

// `role` stays loose (string) because Better Auth's inferred session types
// it as string, not the pg enum.
// Banned staff lose access immediately — a ban check gates every action
// regardless of role, so a banned author/admin can't sneak in on a stale
// session (ADM-10).
export function canPerformAction(
  user: { role?: string | null; bannedAt?: Date | null },
  action: Action,
): boolean {
  if (user.bannedAt) return false;
  const actions = ROLE_ACTIONS[user.role as Role];
  return actions?.includes(action) ?? false;
}

// Roles that can perform `action`, derived from the same map so a new staff
// role automatically shows up wherever this is used (e.g. the admin
// dashboard's staff-author filter) without a second list to keep in sync.
export function rolesWithAction(action: Action): Role[] {
  return (Object.keys(ROLE_ACTIONS) as Role[]).filter((role) =>
    ROLE_ACTIONS[role].includes(action),
  );
}
