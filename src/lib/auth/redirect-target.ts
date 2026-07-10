// Shared by client (sign-in buttons) and server (sign-in redirect gate),
// so no "server-only" here.

// Clamp a ?next= value to a same-origin path. Rejects non-strings (Next
// delivers duplicate params as string[]), values not starting with "/",
// protocol-relative forms ("//", "/\"), and any whitespace or control
// character — browsers strip \t \r \n before URL parsing, so "/\t/evil.com"
// would otherwise resolve as //evil.com (open redirect).
export function safeNextPath(
  next: string | string[] | null | undefined,
): string {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\") ||
    /[\s\p{Cc}]/u.test(next)
  ) {
    return "/";
  }
  return next;
}
