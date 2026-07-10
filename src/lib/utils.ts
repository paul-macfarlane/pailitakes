// Stays at src/lib/utils.ts: shadcn generators hardcode the "@/lib/utils" import.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
