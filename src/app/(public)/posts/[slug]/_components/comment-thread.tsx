import { CommentItem } from "@/app/(public)/posts/[slug]/_components/comment-item";
import type { CommentNode } from "@/lib/comments/tree";
import { cn } from "@/lib/utils";

// Recursive list wrapper (FR-4.2): each level of real nesting gets its own
// `<ul>` with a small fixed indent (border-l + pl-3) — CommentItem decides
// when to keep recursing here vs. switch to FlatReplies past depth 5.
export function CommentThread({
  nodes,
  depth,
}: {
  nodes: CommentNode[];
  depth: number;
}) {
  if (nodes.length === 0) return null;

  return (
    <ul className={cn("flex flex-col gap-4", depth > 0 && "border-l pl-3")}>
      {nodes.map((node) => (
        <li key={node.id}>
          <CommentItem node={node} depth={depth} />
        </li>
      ))}
    </ul>
  );
}
