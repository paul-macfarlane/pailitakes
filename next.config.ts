import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components (Next 16 PPR): public pages cache via `use cache` +
  // cacheTag/cacheLife and invalidate with revalidateTag (design §3).
  cacheComponents: true,
};

export default nextConfig;
