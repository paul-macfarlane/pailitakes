import { describe, expect, it } from "vitest";

import { computeVisitorHash, dailySalt } from "./visitor-hash";

const SEED = "test-seed-value";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (test)";

describe("dailySalt", () => {
  it("is deterministic for the same seed and UTC day", () => {
    const a = dailySalt(SEED, new Date("2026-07-12T10:00:00Z"));
    const b = dailySalt(SEED, new Date("2026-07-12T23:59:59Z"));
    expect(a).toBe(b);
  });

  it("differs across a UTC day boundary", () => {
    const before = dailySalt(SEED, new Date("2026-07-12T23:59:59Z"));
    const after = dailySalt(SEED, new Date("2026-07-13T00:00:01Z"));
    expect(before).not.toBe(after);
  });
});

describe("computeVisitorHash", () => {
  const now = new Date("2026-07-12T12:00:00Z");

  it("is deterministic for identical inputs", () => {
    const a = computeVisitorHash(SEED, IP, UA, now);
    const b = computeVisitorHash(SEED, IP, UA, now);
    expect(a).toBe(b);
  });

  it("differs across a UTC day boundary for the same ip/ua", () => {
    const before = computeVisitorHash(
      SEED,
      IP,
      UA,
      new Date("2026-07-12T23:59:59Z"),
    );
    const after = computeVisitorHash(
      SEED,
      IP,
      UA,
      new Date("2026-07-13T00:00:01Z"),
    );
    expect(before).not.toBe(after);
  });

  it("differs by ip", () => {
    const a = computeVisitorHash(SEED, "203.0.113.7", UA, now);
    const b = computeVisitorHash(SEED, "203.0.113.8", UA, now);
    expect(a).not.toBe(b);
  });

  it("differs by user agent", () => {
    const a = computeVisitorHash(SEED, IP, "Mozilla/5.0 (a)", now);
    const b = computeVisitorHash(SEED, IP, "Mozilla/5.0 (b)", now);
    expect(a).not.toBe(b);
  });

  it("is a 64-character lowercase hex string", () => {
    const hash = computeVisitorHash(SEED, IP, UA, now);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
