import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth/auth";
import { Action, canPerformAction } from "@/lib/auth/permissions";

// Request-scoped session read for Server Components and server actions.
// cache() dedupes lookups within a single render pass.
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

// Canonical /admin gate. Layouts and pages render in parallel, so the admin
// layout's gate cannot protect page content — every /admin page must call
// this itself. Reading the session here also forces the page dynamic
// (design §3: /admin/** is fully dynamic, never prerendered).
// getSession's cache() makes the layout + page double-call one DB lookup.
// Pages below /admin pass their own path as `next` (server components can't
// read the request path) so a stale-cookie re-auth returns to the right page.
export async function requireStaff(next = "/admin") {
  const session = await getSession();
  if (!session) {
    // Reached only with a stale/revoked cookie (the proxy already bounced
    // cookieless requests, preserving the deep path). ?next= both restores
    // the destination and exempts this hop from the proxy's signed-in
    // /sign-in → / redirect, which would otherwise trap stale cookies.
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }
  if (!canPerformAction(session.user, Action.AccessAdmin)) {
    redirect("/");
  }
  return session;
}

// Capability-gated page gate, generalizing requireAdmin (ADM-10, SRCH-1).
// Layers on requireStaff: a signed-out user still gets the sign-in redirect
// and a non-staff user still goes home, but a staff user lacking `action`
// gets a 404 (the page simply doesn't exist for them). For SERVER ACTIONS use
// an inline canPerformAction check instead — notFound() is a page/render
// concern.
export async function requireCapability(action: Action, next: string) {
  const session = await requireStaff(next);
  if (!canPerformAction(session.user, action)) {
    notFound();
  }
  return session;
}

// Admin-only page gate (ADM-10). Thin delegate to requireCapability so every
// existing /admin/users call site keeps its exact signature/behavior.
export async function requireAdmin(next = "/admin") {
  return requireCapability(Action.ManageUsers, next);
}
