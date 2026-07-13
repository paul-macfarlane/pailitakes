import type { Metadata } from "next";

import { AnalyticsDashboard } from "@/app/admin/analytics/_components/analytics-dashboard";
import { Action } from "@/lib/auth/permissions";
import { requireCapability } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

// Admin-only (FR-8.2/8.3). A staff-but-non-admin author gets a 404 here —
// same requireCapability/notFound() pattern as requireAdmin on /admin/users
// and requireCapability(ManageCategories) on /admin/categories. No data
// fetching here: the dashboard is deliberately client-fetched with TanStack
// Query against the uncached /api/admin/analytics route (design §3/§5.6).
export default async function AdminAnalyticsPage() {
  await requireCapability(Action.ViewAnalytics, "/admin/analytics");

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Analytics</h1>
      <AnalyticsDashboard />
    </>
  );
}
