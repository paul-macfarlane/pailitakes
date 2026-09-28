import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requirePostIdParam } from "@/lib/admin/route-params";
import { requireStaff } from "@/lib/auth/session";
import { getCollaboratorsService } from "@/lib/collaboration/service";
import { CollaboratorControls } from "./_components/collaborator-controls";

export const metadata: Metadata = {
  title: "Sharing",
  robots: { index: false, follow: false },
};

// Owner/admin only (FR-7.14). A separate page rather than an editor panel:
// the editor flushes before leaving, so a membership change can never race
// the owner's own unsaved edits.
export default async function SharingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireStaff(`/admin/posts/${id}/sharing`);
  const postId = requirePostIdParam(id);
  const sharing = await getCollaboratorsService(session.user, postId);
  if (!sharing) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/admin/posts/${postId}/edit`} className="text-sm underline">
        ← Back to editor
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Sharing</h1>
        <p className="mt-1 break-words text-muted-foreground">
          {sharing.title}
        </p>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Reviewer</span> reads
          the private draft and its reviews.
        </li>
        <li>
          <span className="font-medium text-foreground">Editor</span> can also
          edit the draft directly.
        </li>
        <li>
          Only you or an admin can publish, apply reviews, or change sharing.
        </li>
      </ul>
      <CollaboratorControls
        postId={postId}
        members={sharing.members}
        options={sharing.options}
      />
    </div>
  );
}
