import type { Metadata } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Fail fast on invalid configuration (validated once, server-only).
import "@/lib/shared/env";

import { ThemeProvider } from "@/components/theme-provider";

// Loads the font files; globals.css references the resulting family names
// literally in @theme inline (which can't resolve runtime CSS variables).
// Swapping fonts means updating globals.css too.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  // 800 covers @tailwindcss/typography's prose-h1 weight so user-authored
  // markdown headings don't get faux-bold synthesis.
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Paulitakes",
    template: "%s · Paulitakes",
  },
  description: "Hot takes, cold analysis. A mobile-first sports blog.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes stamps the theme class on <html>
    // before hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
