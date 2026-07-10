// Shared server-action return shape (design §8, §9). No "server-only" here:
// it's a plain type, and importing it never pulls server-only code into a
// client bundle.
export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string };
