"use server";

// Preview lets an author see rendered output before saving. Same staff gate
// and error shape as src/actions/posts.ts; "use server" files export only
// actions, so the 3-line staff-session helper is duplicated here rather than
// imported.

import { z } from "zod";

import type { ActionResult } from "@/actions/posts";
import { isStaff } from "@/lib/authz";
import { renderMarkdown } from "@/lib/markdown";
import { getSession } from "@/lib/session";

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Staff-only gate shared by every action below (authors + admins; §5.7).
async function staffSession() {
  const session = await getSession();
  return session && isStaff(session.user) ? session : null;
}

// Same cap as post-input's bodyMd.
const previewInputSchema = z.object({
  bodyMd: z.string().max(100_000),
});

// Renders draft markdown through the exact production pipeline (design
// §5.1, FR-7.2) so the editor's preview pane is pixel-identical to the
// published post page — never a second, divergent rendering path.
export async function renderPostPreview(
  input: unknown,
): Promise<ActionResult<{ html: string }>> {
  // Session/role checked before parsing input (engineering rules: session ->
  // role -> everything else).
  const session = await staffSession();
  if (!session) {
    return { ok: false, error: "Not authorized." };
  }

  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  try {
    const html = await renderMarkdown(parsed.data.bodyMd);
    return { ok: true, data: { html } };
  } catch (err) {
    console.error("renderPostPreview failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
