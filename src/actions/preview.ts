"use server";

// Preview lets an author see rendered output before saving. Same staff gate
// and error shape as the post actions (src/actions/posts/*).

import { z } from "zod";

import { actionSession } from "@/lib/auth/guards";
import { Action } from "@/lib/auth/permissions";
import { renderMarkdown } from "@/lib/content/markdown";
import {
  GENERIC_ERROR,
  NOT_AUTHORIZED_ERROR,
  type ActionResult,
} from "@/lib/shared/action-result";

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
  const session = await actionSession(Action.PreviewPost);
  if (!session) {
    return { ok: false, error: NOT_AUTHORIZED_ERROR };
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
