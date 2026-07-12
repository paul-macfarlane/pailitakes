"use client";

import { createContext } from "react";

import type { CommentNode } from "@/lib/comments/tree";

// Shared session/capability state + cache-mutation callbacks for the comment
// tree (CMT-3/7/8), threaded down through CommentThread -> CommentItem ->
// reply/edit composers without prop-drilling every level. Mirrors
// EditorFlushContext's shape (src/app/admin/posts/_components/
// editor-flush-context.tsx): provided once by CommentsSection, null outside
// that tree (callers never render comment components outside it, so a null
// read is a programmer error, not a state to design around).
export type CommentsContextValue = {
  postId: string;
  // Null when signed out — ownership checks below always compare against a
  // real id, so null trivially fails every `=== currentUserId` check.
  currentUserId: string | null;
  isBanned: boolean;
  // Action.ManageAnyComment (FR-4.4 admin delete-any); already false for a
  // banned admin (canPerformAction folds bannedAt in).
  canManageAny: boolean;
  // session present && !isBanned && comments not locked/archived — gates the
  // root composer AND the presence of a Reply button (own edit/delete are
  // NOT gated by this: locking blocks new comments, not managing existing
  // ones — src/lib/comments/service/manage.ts has no lock check).
  canCompose: boolean;
  // Inserts a `visible` create result into the cached tree (design §5.3
  // "optimistic insert on allow") at the given parent (null = top-level).
  onCreated: (parentId: string | null, node: CommentNode) => void;
  // Patches an edited node's body/editedAt in place (editComment's
  // `visible` arm).
  onEdited: (id: string, body: string, editedAt: string | null) => void;
  // A `locked`/`archived` denial reason means the post's comment state
  // changed since the page loaded — flips the section to its locked/closed
  // notice for the rest of this visit rather than letting every further
  // attempt silently fail the same way.
  onDenialLock: (message: string) => void;
  // Delete, and an edit that comes back held/rejected (no longer publicly
  // visible), both change the tree in a way that's simplest to reconcile by
  // refetching rather than hand-patching every possible pruning outcome.
  onNeedsRefetch: () => void;
};

export const CommentsContext = createContext<CommentsContextValue | null>(null);
