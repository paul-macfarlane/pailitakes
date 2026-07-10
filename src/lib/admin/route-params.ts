import { notFound } from "next/navigation";
import { z } from "zod";

// Validates an admin route's [id] param as a UUID, 404ing a malformed one —
// the same "not found" outcome as an unknown/not-owned id, so there's no
// existence oracle. Shared by the post edit and preview routes so the policy
// stays in lockstep. Call AFTER requireStaff (auth before input handling).
export function requirePostIdParam(id: string): string {
  const result = z.uuid().safeParse(id);
  if (!result.success) notFound();
  return result.data;
}
