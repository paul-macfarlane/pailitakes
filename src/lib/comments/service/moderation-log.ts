import "server-only";

// Business logic for the moderation log (CMT-9, design D9): browsing
// held/rejected comments, approving a held comment, and restoring a
// rejected false positive. DB access lives in src/lib/comments/data.ts;
// admin gating happens in the thin action (src/actions/comments.ts).

import {
  casCommentStatus,
  listModerationLogRows,
  MODERATION_LOG_PAGE_SIZE,
  type ModerationLogRow,
} from "@/lib/comments/data";
import { CommentStatus } from "@/lib/comments/status";
import { GENERIC_ERROR, type ActionResult } from "@/lib/shared/action-result";

// Not CONFLICT_ERROR (src/lib/shared/action-result.ts): that copy names
// "post" specifically and would misdescribe a comment moderation conflict.
const MODERATION_CONFLICT_ERROR =
  "This comment was already resolved elsewhere. Reload and try again.";

export { MODERATION_LOG_PAGE_SIZE };

// Newest first, paginated (mirrors the admin users list's limit/offset +
// has-next pattern, src/lib/users/admin.ts). `page` is 1-based; the offset
// math lives here since there's no UI yet to do it in a page.tsx.
export async function listModerationLog(params: {
  status: typeof CommentStatus.Held | typeof CommentStatus.Rejected;
  page: number;
}): Promise<{ rows: ModerationLogRow[]; hasMore: boolean }> {
  const page = Number.isFinite(params.page)
    ? Math.max(Math.trunc(params.page), 1)
    : 1;
  const offset = (page - 1) * MODERATION_LOG_PAGE_SIZE;

  return listModerationLogRows({
    status: params.status,
    limit: MODERATION_LOG_PAGE_SIZE,
    offset,
  });
}

// CAS held -> visible; no matching row (already resolved, or a bad id) is a
// conflict, not a silent no-op (design D9).
export async function approveHeldComment(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const updated = await casCommentStatus(
      id,
      CommentStatus.Held,
      CommentStatus.Visible,
    );
    if (!updated) {
      return { ok: false, error: MODERATION_CONFLICT_ERROR };
    }
    return { ok: true, data: { id } };
  } catch (err) {
    console.error("approveHeldComment failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// CAS rejected -> visible, for clear false positives (design §5.2
// "Moderation log").
export async function restoreRejectedComment(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const updated = await casCommentStatus(
      id,
      CommentStatus.Rejected,
      CommentStatus.Visible,
    );
    if (!updated) {
      return { ok: false, error: MODERATION_CONFLICT_ERROR };
    }
    return { ok: true, data: { id } };
  } catch (err) {
    console.error("restoreRejectedComment failed", err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
