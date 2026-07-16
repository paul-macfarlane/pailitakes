"use client";

import { useContext, useState, useTransition } from "react";

import { deleteComment, editComment, createComment } from "@/actions/comments";
import { setCommentLike } from "@/actions/likes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CommentComposer } from "@/app/(public)/posts/[slug]/_components/comment-composer";
import { CommentsContext } from "@/app/(public)/posts/[slug]/_components/comments-context";
import { CommentThread } from "@/app/(public)/posts/[slug]/_components/comment-thread";
import { LikeButton } from "@/app/(public)/posts/[slug]/_components/like-button";
import { CommentDenialReason } from "@/lib/comments/denial";
import { linkifyText } from "@/lib/comments/linkify";
import { CommentStatus } from "@/lib/comments/status";
import { CommentSubmitStatus } from "@/lib/comments/submit-result";
import type { CommentNode } from "@/lib/comments/tree";

// Client-rendered only (no SSR of this island — design §2), so unlike
// post-article.tsx's UTC-pinned formatter there's no hydration mismatch to
// guard against; showing the viewer's own locale/timezone is strictly
// friendlier for a comment timestamp.
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// FR-4.2: indent through depth 0-5, then flatten deeper replies at the
// depth-5 visual level (see the recursion below and FlatReplies) — a fixed
// cap keeps a long reply chain usable at 375px width.
const MAX_INDENT_DEPTH = 5;

// Comment bodies are plain text (FR-4.5): no markdown/HTML, line breaks
// preserved via `whitespace-pre-wrap`, bare URLs auto-linked. JSX text
// rendering escapes by default — no dangerouslySetInnerHTML.
function CommentBody({ body }: { body: string }) {
  const segments = linkifyText(body);
  return (
    <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">
      {segments.map((segment, index) =>
        segment.type === "url" ? (
          <a
            key={index}
            href={segment.value}
            rel="nofollow ugc noopener noreferrer"
            target="_blank"
            className="break-all underline underline-offset-2 hover:text-foreground"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

// The muted label a flattened reply carries once depth stops increasing —
// derived from the tree structure (design D4/D5 placeholder rules), never
// from a separate lookup.
function replyLabel(node: CommentNode): string {
  if (node.author) return `@${node.author.name}`;
  return node.status === CommentStatus.Deleted
    ? "a deleted comment"
    : "a removed comment";
}

// Pre-order flatten of everything below a depth-5 node: each entry keeps its
// OWN immediate parent's label (not the depth-5 ancestor's), so a 3-deep
// flattened sub-chain still reads correctly ("replying to @b", "replying to
// @c", ...) even though none of it is visually indented further.
type FlatEntry = { node: CommentNode; parentLabel: string };
function flattenReplies(
  nodes: CommentNode[],
  parentLabel: string,
): FlatEntry[] {
  const out: FlatEntry[] = [];
  for (const node of nodes) {
    out.push({ node, parentLabel });
    out.push(...flattenReplies(node.children, replyLabel(node)));
  }
  return out;
}

function FlatReplies({
  nodes,
  parentLabel,
}: {
  nodes: CommentNode[];
  parentLabel: string;
}) {
  const entries = flattenReplies(nodes, parentLabel);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-4 border-l pl-3">
      {entries.map((entry) => (
        <li key={entry.node.id}>
          <CommentItem
            node={entry.node}
            depth={MAX_INDENT_DEPTH}
            parentLabel={entry.parentLabel}
            flat
          />
        </li>
      ))}
    </ul>
  );
}

export function CommentItem({
  node,
  depth,
  parentLabel,
  flat = false,
}: {
  node: CommentNode;
  depth: number;
  parentLabel?: string;
  flat?: boolean;
}) {
  const ctx = useContext(CommentsContext);
  if (!ctx) {
    throw new Error("CommentItem must render inside CommentsSection.");
  }

  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const isPlaceholder = node.status !== CommentStatus.Visible;
  // Placeholders (design D4/D5) are never a composer target — no reply,
  // never editable/deletable (there's nothing left to act on).
  const isOwn = !isPlaceholder && ctx.currentUserId === node.author?.id;
  const canEdit = isOwn && !ctx.isBanned;
  const canDelete =
    !isPlaceholder && ((isOwn && !ctx.isBanned) || ctx.canManageAny);
  const canReply = !isPlaceholder && ctx.canCompose;

  // Arrow function expression (not a hoisted function declaration): TS only
  // carries the `if (!ctx) throw` narrowing above into closures that are
  // expressions evaluated in place, not into function declarations.
  const handleDeleteConfirm = () => {
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteComment(node.id);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      setDeleteOpen(false);
      ctx.onNeedsRefetch();
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <Avatar size="sm" className="mt-0.5 shrink-0">
          {!isPlaceholder && node.author!.image ? (
            <AvatarImage src={node.author!.image} alt="" />
          ) : null}
          <AvatarFallback>
            {isPlaceholder
              ? "–"
              : node.author!.name.slice(0, 1).toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          {flat && parentLabel && (
            <p className="text-xs text-muted-foreground">
              replying to {parentLabel}
            </p>
          )}

          {isPlaceholder ? (
            <p className="text-sm text-muted-foreground italic">
              {node.status === CommentStatus.Deleted
                ? "[deleted]"
                : "[removed]"}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{node.author!.name}</span>
                <span className="text-xs text-muted-foreground">
                  <time dateTime={node.createdAt}>
                    {dateFormat.format(new Date(node.createdAt))}
                  </time>
                  {node.editedAt ? " (edited)" : ""}
                </span>
              </div>

              {isEditing ? (
                <div className="mt-1">
                  <CommentComposer
                    label="Edit comment"
                    initialValue={node.body}
                    submitLabel="Save"
                    pendingLabel="Saving…"
                    autoFocus
                    onSubmit={(body) => editComment(node.id, { body })}
                    onResult={(result) => {
                      if (result.status === CommentSubmitStatus.Visible) {
                        ctx.onEdited(
                          node.id,
                          result.comment.body,
                          result.comment.editedAt,
                        );
                        setIsEditing(false);
                      } else if (
                        result.status === CommentSubmitStatus.Held ||
                        result.status === CommentSubmitStatus.Rejected
                      ) {
                        // No longer publicly visible — reconcile via refetch
                        // (design: this comment's own place in the tree may
                        // now be pruned or become a placeholder).
                        ctx.onNeedsRefetch();
                      }
                      // denied/error: the composer already shows its own
                      // inline message and stays open for another attempt.
                    }}
                    onCancel={() => setIsEditing(false)}
                  />
                </div>
              ) : (
                <CommentBody body={node.body} />
              )}
            </>
          )}

          {!isPlaceholder && !isEditing && (
            <div className="mt-1 flex items-center gap-3">
              {/* No cache invalidation on like (LIKE-3): the optimistic
                  liked/count state lives entirely inside LikeButton, seeded
                  once from this node's likeCount/likedByMe — a later
                  refetch (e.g. after a sibling delete) may hand this row a
                  stale count, which is acceptable and self-corrects on the
                  next full reload. */}
              <LikeButton
                likeCount={node.likeCount}
                likedByMe={node.likedByMe}
                signedIn={ctx.currentUserId != null}
                onSetLike={(liked) => setCommentLike(node.id, liked)}
                label="comment"
              />
              {canReply && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsReplying((v) => !v)}
                >
                  Reply
                </Button>
              )}
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </Button>
              )}
              {canDelete && (
                <AlertDialog
                  open={deleteOpen}
                  onOpenChange={(next) => {
                    setDeleteOpen(next);
                    // A failure message belongs to the attempt it answered —
                    // reopening the dialog later starts clean.
                    if (!next) setDeleteError(null);
                  }}
                >
                  <AlertDialogTrigger
                    render={<Button type="button" variant="ghost" size="xs" />}
                  >
                    Delete
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. If it has replies, it will be
                        replaced with a &ldquo;[deleted]&rdquo; placeholder
                        instead of removed outright.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {/* Failures keep the dialog open, so the message must
                        render INSIDE it — a paragraph outside sits behind
                        the dialog overlay where the user can't see it. */}
                    {deleteError && (
                      <p role="alert" className="text-sm text-destructive">
                        {deleteError}
                      </p>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeleting}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={isDeleting}
                        onClick={handleDeleteConfirm}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

          {isReplying && (
            <div className="mt-2">
              <CommentComposer
                label={`Reply to ${node.author?.name ?? "comment"}`}
                placeholder={`Reply to ${node.author?.name ?? ""}…`}
                submitLabel="Reply"
                pendingLabel="Replying…"
                autoFocus
                onSubmit={(body) =>
                  createComment({ postId: ctx.postId, parentId: node.id, body })
                }
                onResult={(result) => {
                  if (result.status === CommentSubmitStatus.Visible) {
                    ctx.onCreated(node.id, result.comment);
                    setIsReplying(false);
                  } else if (
                    result.status === CommentSubmitStatus.Denied &&
                    (result.reason === CommentDenialReason.Locked ||
                      result.reason === CommentDenialReason.Archived)
                  ) {
                    ctx.onDenialLock(result.message);
                  }
                }}
                onCancel={() => setIsReplying(false)}
              />
            </div>
          )}
        </div>
      </div>

      {!flat &&
        node.children.length > 0 &&
        (depth < MAX_INDENT_DEPTH ? (
          <CommentThread nodes={node.children} depth={depth + 1} />
        ) : (
          <FlatReplies nodes={node.children} parentLabel={replyLabel(node)} />
        ))}
    </div>
  );
}
