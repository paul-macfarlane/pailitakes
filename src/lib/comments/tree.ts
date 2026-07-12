// Client-safe pure tree assembly (no schema/server-only import — it crosses
// the JSON boundary as the shape /api/comments returns and the UI renders,
// design D4/D5). All nesting, ordering, and redaction happens here so no
// caller (the read route, the create/edit "visible" result arm) can leak a
// non-visible comment's body or author.

import { CommentStatus } from "@/lib/comments/status";

// Raw row shape read by src/lib/comments/data.ts's thread query (one row per
// comment, author joined in) — the input to buildCommentTree.
export type CommentRow = {
  id: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  body: string;
  status: CommentStatus;
  createdAt: Date;
  editedAt: Date | null;
  // Read-time aggregates (design §5.4, LIKE-3): counted/checked alongside the
  // tree query in loadCommentRowsForPost, not denormalized on the row.
  likeCount: number;
  likedByMe: boolean;
};

// Dates are ISO strings (not Date) because this type crosses the JSON
// boundary (design D4).
export type CommentNode = {
  id: string;
  parentId: string | null;
  body: string;
  status: CommentStatus;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string; image: string | null } | null;
  likeCount: number;
  likedByMe: boolean;
  children: CommentNode[];
};

// Nests rows by parentId, then prunes/redacts in one post-order pass:
//   - A `visible` node always shows its body/author.
//   - A non-visible node (deleted/held/rejected) is redacted (body "",
//     author null, status preserved so the UI can label it) and kept ONLY if
//     it has at least one visible descendant — otherwise it's dropped. D5:
//     generalizing beyond just "deleted" placeholders covers the race where
//     an edit flags a parent (turning it `rejected`) that still has visible
//     replies — those replies must not be orphaned.
// Children are ordered createdAt asc, id as a stable tiebreak.
export function buildCommentTree(rows: CommentRow[]): CommentNode[] {
  const nodesById = new Map<string, CommentNode>();
  for (const row of rows) {
    const visible = row.status === CommentStatus.Visible;
    nodesById.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      body: visible ? row.body : "",
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      author: visible
        ? { id: row.authorId, name: row.authorName, image: row.authorImage }
        : null,
      // A redacted placeholder renders no like button — zeroing these
      // alongside body/author keeps a non-visible node from leaking a like
      // count for content the reader can't see.
      likeCount: visible ? row.likeCount : 0,
      likedByMe: visible ? row.likedByMe : false,
      children: [],
    });
  }

  const roots: CommentNode[] = [];
  for (const row of rows) {
    const node = nodesById.get(row.id)!;
    const parent = row.parentId ? nodesById.get(row.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function byCreatedThenId(a: CommentNode, b: CommentNode): number {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  // Post-order: children are pruned first, so `children.length > 0` after
  // recursing already means "has at least one visible descendant" —
  // transitively, since a pruned child only survives if IT is visible or has
  // one of its own.
  function sortAndPrune(nodes: CommentNode[]): CommentNode[] {
    const kept: CommentNode[] = [];
    for (const node of nodes) {
      node.children = sortAndPrune(node.children);
      if (node.status === CommentStatus.Visible || node.children.length > 0) {
        kept.push(node);
      }
    }
    kept.sort(byCreatedThenId);
    return kept;
  }

  return sortAndPrune(roots);
}

// Same tie-break as buildCommentTree's byCreatedThenId (createdAt asc, id as
// stable tiebreak) — kept as its own copy rather than exported/shared: it
// operates on an already-built CommentNode[] (client cache), not raw rows,
// so the two call sites never need to agree on a signature.
function byCreatedThenId(a: CommentNode, b: CommentNode): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Inserts a freshly-created node into an already-rendered tree (CMT-3,
// design §5.3 "optimistic insert on allow") without a refetch: the comments
// island calls this from setQueryData after createComment's `visible` arm.
// Immutable (returns a new array/spine down to the insertion point) so
// TanStack Query's reference-equality change detection re-renders correctly.
export function insertCommentNode(
  nodes: CommentNode[],
  parentId: string | null,
  node: CommentNode,
): CommentNode[] {
  if (parentId === null) {
    return [...nodes, node].sort(byCreatedThenId);
  }
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: [...n.children, node].sort(byCreatedThenId) }
      : { ...n, children: insertCommentNode(n.children, parentId, node) },
  );
}

// Patches an edited node in place (editComment's `visible` arm) so an own
// edit shows up without a refetch, mirroring insertCommentNode's shape.
export function updateCommentNode(
  nodes: CommentNode[],
  id: string,
  patch: Pick<CommentNode, "body" | "editedAt">,
): CommentNode[] {
  return nodes.map((n) =>
    n.id === id
      ? { ...n, ...patch }
      : { ...n, children: updateCommentNode(n.children, id, patch) },
  );
}

// Drives the "Comments (N)" heading: counts only nodes with a body a reader
// can actually read, so a `deleted`/`held`/`rejected` placeholder never
// inflates the count.
export function countVisibleComments(nodes: CommentNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.status === CommentStatus.Visible) count += 1;
    count += countVisibleComments(node.children);
  }
  return count;
}
