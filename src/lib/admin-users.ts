import "server-only";

import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema";
import type { Role } from "@/lib/roles";
import { escapeLike } from "@/lib/sql-like";

// Re-export under the domain name; the single source is src/lib/roles.ts
// (drift-guarded against the pg enum).
export type UserRole = Role;

// Admin user-management row (ADM-10, FR-10.2).
export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  bannedAt: Date | null;
  createdAt: Date;
};

export const ADMIN_USERS_PAGE_SIZE = 25;

// Pure decision for the last-admin guard (ADM-10): given the ids of every
// currently-active admin, would removing `targetId` from that set (by
// demotion or ban) leave zero admins? Extracted so the invariant is unit-
// tested directly (the action supplies the row-locked id list).
export function wouldOrphanAdmins(
  activeAdminIds: string[],
  targetId: string,
): boolean {
  return activeAdminIds.filter((id) => id !== targetId).length === 0;
}

// Users for the admin user-management screen, newest first. Optional role
// filter and free-text search (name or email, case-insensitive substring).
// Fetches one extra row to report hasMore (same shape as listAdminPosts).
export async function listUsers(params: {
  role?: UserRole;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AdminUserRow[]; hasMore: boolean }> {
  const limit = Math.min(
    Math.max(params.limit ?? ADMIN_USERS_PAGE_SIZE, 1),
    100,
  );
  const offset = Math.max(params.offset ?? 0, 0);

  const conditions: SQL[] = [];
  if (params.role) conditions.push(eq(user.role, params.role));
  const q = params.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const search = or(ilike(user.name, pattern), ilike(user.email, pattern));
    if (search) conditions.push(search);
  }

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      bannedAt: user.bannedAt,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}
