import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local gets 1 retry for the same reason CI gets 2: the fully-parallel
  // suite drives one dev server, and marginal hydration/latency flakes
  // rotate across specs run-to-run. A retried pass is reported as "flaky"
  // (still visible); a real failure fails every attempt.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  // The suite drives an UNOPTIMIZED dev server (webServer: pnpm dev) with
  // full parallelism, so first-hit compiles and client-island fetches
  // routinely exceed Playwright's 5s default under load; 10s keeps latency
  // flakes out without masking real failures.
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Mobile-first project (FR-9.4): critical flows must pass at phone width.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
