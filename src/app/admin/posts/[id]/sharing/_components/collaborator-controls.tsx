"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { requestReview, setCollaborator } from "@/actions/posts/collaborators";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COLLABORATOR_ROLE_LABELS,
  COLLABORATOR_ROLES,
  CollaboratorRole,
} from "@/lib/collaboration/permissions";
import { ReviewStatus } from "@/lib/reviews/input";

type Member = {
  userId: string;
  name: string;
  role: CollaboratorRole;
  reviewStatus: ReviewStatus | null;
};
type Option = { id: string; name: string };

const roleItems = COLLABORATOR_ROLES.map((role) => ({
  value: role,
  label: COLLABORATOR_ROLE_LABELS[role],
}));

function RoleSelect({
  id,
  ariaLabel,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  ariaLabel?: string;
  value: CollaboratorRole;
  onChange: (role: CollaboratorRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      items={roleItems}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roleItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CollaboratorControls({
  postId,
  members,
  options,
}: {
  postId: string;
  members: Member[];
  options: Option[];
}) {
  const router = useRouter();
  const personId = useId();
  const roleId = useId();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // null, not undefined: Base UI treats undefined as uncontrolled (see
  // transfer-posts-control.tsx).
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<CollaboratorRole>(CollaboratorRole.Reviewer);
  const memberIds = new Set(members.map((member) => member.userId));
  const candidates = options.filter((option) => !memberIds.has(option.id));

  function ask(target: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestReview({ postId, userId: target });
        if (!result.ok) setError(result.error);
        else router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function save(
    target: string,
    next: CollaboratorRole | null,
    done?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setCollaborator({
          postId,
          userId: target,
          role: next,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        done?.();
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${personId}-heading`} className="space-y-3">
        <h2 id={`${personId}-heading`} className="text-lg font-medium">
          Share with an author
        </h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every other active author already has access.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Label htmlFor={personId} className="flex-col items-start gap-1">
              Author
              <Select
                items={candidates.map((c) => ({ value: c.id, label: c.name }))}
                value={userId}
                onValueChange={(value) => setUserId(value)}
              >
                <SelectTrigger id={personId} className="w-56 max-w-full">
                  <SelectValue placeholder="Choose an author" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label htmlFor={roleId} className="flex-col items-start gap-1">
              Access
              <RoleSelect id={roleId} value={role} onChange={setRole} />
            </Label>
            <Button
              disabled={isPending || !userId}
              onClick={() => {
                if (userId)
                  save(userId, role, () => {
                    setUserId(null);
                    setRole(CollaboratorRole.Reviewer);
                  });
              }}
            >
              Share
            </Button>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">People with access</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Only you and admins can see this post.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-medium">
                    {member.name}
                  </span>
                  <ReviewStatusBadge status={member.reviewStatus} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {member.reviewStatus !== ReviewStatus.Requested &&
                    member.reviewStatus !== ReviewStatus.InProgress && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        aria-label={`Request review from ${member.name}`}
                        onClick={() => ask(member.userId)}
                      >
                        Request review
                      </Button>
                    )}
                  <RoleSelect
                    ariaLabel={`Access for ${member.name}`}
                    value={member.role}
                    disabled={isPending}
                    onChange={(next) => save(member.userId, next)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    aria-label={`Remove ${member.name}`}
                    onClick={() => save(member.userId, null)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
