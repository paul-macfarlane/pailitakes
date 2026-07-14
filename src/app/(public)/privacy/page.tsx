import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Paulitakes collects, why, and how it's protected.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <article className="prose dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p>Effective: July 14, 2026</p>

        <h2>What we collect</h2>
        <p>
          You can sign in with Google or Discord — there&apos;s no
          email/password option. When you sign in, we store the name, email
          address, and avatar URL your provider gives us, along with your
          account role and account timestamps. A session cookie keeps you signed
          in; each sign-in session record includes the IP address and browser
          user-agent used to create it.
        </p>
        <p>
          If you like a post or comment, we store which account liked which post
          or comment and when.
        </p>

        <h2>Comments &amp; moderation</h2>
        <p>
          Comments are plain text. Every comment you submit is stored along with
          its moderation status. To keep the site family-friendly, your comment
          text is sent to an AI model (Anthropic&apos;s Claude, via Vercel AI
          Gateway) for automated moderation, and we keep a moderation audit
          record (verdict, reason, model, and latency) alongside the comment.
          Comments may be automatically rejected or held for review, and
          repeated rejections can lead to an automatic ban from commenting.
        </p>

        <h2>Analytics</h2>
        <p>
          We record page views to understand what people read, but not who reads
          it. Each view is tagged with an anonymized visitor hash — a one-way
          salted hash of your IP address and browser user-agent, where the salt
          rotates daily. This means the same visitor can be distinguished across
          page views on a given day, but not correlated from one day to the
          next. We never store your raw IP address or user-agent for analytics,
          and we don&apos;t use analytics cookies. Known bots and crawlers are
          excluded from analytics entirely.
        </p>

        <h2>Cookies &amp; local storage</h2>
        <p>
          Aside from the sign-in session cookie described above, the only other
          thing we keep in your browser is your theme preference (light, dark,
          or system) in localStorage. That preference never leaves your device.
        </p>

        <h2>Third-party services</h2>
        <ul>
          <li>Google and Discord, for OAuth sign-in.</li>
          <li>Vercel, for hosting and infrastructure.</li>
          <li>
            Anthropic, via Vercel AI Gateway, for automated comment moderation.
          </li>
        </ul>
        <p>
          We don&apos;t run ads, use third-party trackers, or sell your personal
          data.
        </p>

        <h2>Data retention &amp; deletion</h2>
        <p>
          There&apos;s no self-serve account deletion yet. If you&apos;d like
          your account or data deleted, contact the site operator to request it.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this policy as the site evolves. Material changes will
          update the effective date above.
        </p>

        <h2>Contact</h2>
        <p>Questions about this policy? Reach out to the site operator.</p>
      </article>
    </main>
  );
}
