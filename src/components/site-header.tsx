import Link from "next/link";

import { HeaderAuth } from "@/components/header-auth";

// Static shell — no request data. Session state renders inside the
// HeaderAuth client island so public pages remain ISR-cacheable.
export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Paulitakes
        </Link>
        <HeaderAuth />
      </div>
    </header>
  );
}
