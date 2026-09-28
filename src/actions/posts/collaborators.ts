"use server";

import { z } from "zod";
import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import { COLLABORATOR_ROLES } from "@/lib/collaboration/permissions";
import { setCollaboratorService } from "@/lib/collaboration/service";
import { NOT_AUTHORIZED_ERROR } from "@/lib/shared/action-result";

// role null revokes. Owner/admin-only management is enforced in the service,
// under the post lock (ADR-0037).
const inputSchema = z
  .object({
    postId: z.uuid(),
    userId: z.string().min(1).max(200),
    role: z.enum(COLLABORATOR_ROLES).nullable(),
  })
  .strict();

export async function setCollaborator(input: unknown) {
  const session = await actionSession(Action.EditPost);
  if (!session) return { ok: false, error: NOT_AUTHORIZED_ERROR } as const;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Invalid collaborator." } as const;
  return setCollaboratorService(session.user, parsed.data);
}
