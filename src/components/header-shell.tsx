import { cn } from "@/lib/utils";

// Shared chrome for the public and admin headers: the sticky/backdrop-blur
// treatment, height, and container live here so the surfaces can't drift.
export function HeaderShell({
  maxWidthClass,
  children,
}: {
  maxWidthClass: string;
  children: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-sm">
      <div
        className={cn(
          "mx-auto flex h-14 w-full items-center justify-between gap-4 px-4",
          maxWidthClass,
        )}
      >
        {children}
      </div>
    </header>
  );
}
