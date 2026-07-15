import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using Paulitakes.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <article className="prose dark:prose-invert">
        <h1>Terms of Service</h1>
        <p>Effective: July 14, 2026</p>

        <h2>Acceptance</h2>
        <p>
          By using Paulitakes, you agree to these terms. This is a solo sports
          blog, not a bank — the terms below are meant to be reasonable and
          plainly stated.
        </p>

        <h2>Accounts</h2>
        <p>
          You sign in with Google or Discord. You&apos;re responsible for
          activity on your account. We may suspend or ban accounts that violate
          these terms.
        </p>
        <p>
          You may delete your account at any time from your account page. What
          happens to your data when you do is described in the{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <h2>User content</h2>
        <p>
          Comments must be family-friendly: no NSFW content, slurs, harassment,
          or spam. Comments are automatically screened and may be rejected or
          held for review; repeated violations can lead to a ban. You retain
          ownership of the comments you post, and you grant us a license to
          display them on the site.
        </p>

        <h2>Site content</h2>
        <p>
          Posts are © their respective authors. Content on Paulitakes is sports
          commentary and opinion for entertainment purposes — we make no
          warranty as to its accuracy.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Don&apos;t attempt to abuse, disrupt, or gain unauthorized access to
          the site or its infrastructure, and don&apos;t use the site to violate
          applicable law.
        </p>

        <h2>Disclaimers &amp; limitation of liability</h2>
        <p>
          The site is provided &quot;as is,&quot; without warranties of any
          kind. To the fullest extent permitted by law, Paulitakes and its
          operator aren&apos;t liable for damages arising from your use of the
          site.
        </p>

        <h2>Changes to these terms</h2>
        <p>
          We may update these terms as the site evolves. Material changes will
          update the effective date above.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms? Email{" "}
          <a href="mailto:paulitakesweb@gmail.com">paulitakesweb@gmail.com</a>.
        </p>
      </article>
    </main>
  );
}
