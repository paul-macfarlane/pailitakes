"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type Provider = "google" | "discord";

// Official four-color Google "G" — colors and geometry must not be altered
// and monochrome versions are disallowed (Google sign-in branding
// guidelines, developers.google.com/identity/branding-guidelines).
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// Official Discord "Clyde" mark, unaltered, white on Blurple per Discord's
// brand guidelines (discord.com/branding — Blurple login button set).
function DiscordIcon() {
  return (
    <svg viewBox="0 0 127.14 96.36" className="h-4 w-5" aria-hidden="true">
      <path
        fill="#FFFFFF"
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
      />
    </svg>
  );
}

const providerLabels: Record<Provider, string> = {
  google: "Continue with Google",
  discord: "Continue with Discord",
};

// Brand-mandated button styling (reason for bypassing the shadcn variants):
// Google light theme = #FFFFFF fill / #747775 stroke / #1F1F1F text, dark
// theme = #131314 / #8E918F / #E3E3E3; Discord = Blurple #5865F2 with white
// text (#4752C4 pressed/hover from Discord's button set).
const providerClasses: Record<Provider, string> = {
  google:
    "border border-[#747775] bg-white text-[#1F1F1F] hover:bg-white/90 dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#131314]/90",
  discord: "border-0 bg-[#5865F2] text-white hover:bg-[#4752C4]",
};

export function SignInButtons({ providers }: { providers: Provider[] }) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Coming Back from the OAuth consent screen restores this page from the
  // bfcache with state intact — clear `pending` so the buttons aren't stuck
  // disabled on "Redirecting…".
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setPending(null);
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function handleSignIn(provider: Provider) {
    setPending(provider);
    setError(null);
    const { error: signInError } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
    });
    if (signInError) {
      setError("Sign-in failed. Please try again.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <Button
          key={provider}
          className={`h-10 w-full gap-2.5 px-3 font-medium ${providerClasses[provider]}`}
          disabled={pending !== null}
          onClick={() => handleSignIn(provider)}
        >
          {provider === "google" ? <GoogleIcon /> : <DiscordIcon />}
          {pending === provider ? "Redirecting…" : providerLabels[provider]}
        </Button>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
