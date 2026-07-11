import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SearchForm } from "@/app/(public)/search/_components/search-form";
import { ExternalImage } from "@/components/external-image";
import { Skeleton } from "@/components/ui/skeleton";
import { listActiveCategories } from "@/lib/categories/data";
import {
  searchVisiblePosts,
  SNIPPET_END,
  SNIPPET_START,
  type SearchResult,
} from "@/lib/posts/search";
import {
  searchParamsSchema,
  type SearchPageParams,
} from "@/lib/posts/search-params";

export const metadata: Metadata = {
  title: "Search",
};

const PAGE_SIZE = 20;

// UTC-pinned, same rationale/format as PostCard (src/components/post-card.tsx):
// server-rendered results must show the same date regardless of viewer
// timezone.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

// Query-dependent, never cached (design §2 route table, engineering rules):
// no `use cache` anywhere in this route. searchParams is request data, so it
// (and the DB reads it drives) sits inside the Suspense boundary below
// rather than being read by the page shell itself (ADR-0008).
export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Search</h1>
      <Suspense fallback={<SearchSkeleton />}>
        <SearchSection searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Form + results share one boundary: both the category list and the results
// depend on the same awaited searchParams, and splitting them into separate
// suspended children would mean two round trips (and two skeletons) for no
// benefit (SRCH-5 spec: "a single suspended section ... is acceptable").
async function SearchSection({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParamsSchema.parse(await searchParams);
  const [categories, { results, hasMore }] = await Promise.all([
    listActiveCategories(),
    searchVisiblePosts({
      q: params.q ?? "",
      categorySlug: params.category,
      limit: PAGE_SIZE,
      offset: (params.page - 1) * PAGE_SIZE,
    }),
  ]);

  return (
    <>
      <div className="mt-6">
        <SearchForm
          q={params.q ?? ""}
          category={params.category}
          categories={categories}
        />
      </div>
      <ResultsList q={params.q} results={results} />
      <SearchPagination params={params} hasMore={hasMore} />
    </>
  );
}

function ResultsList({
  q,
  results,
}: {
  q: string | undefined;
  results: SearchResult[];
}) {
  if (!q) {
    return (
      <p className="mt-8 text-muted-foreground">
        Type to search posts by title, body, category, or tag.
      </p>
    );
  }

  if (results.length === 0) {
    return (
      <p className="mt-8 text-muted-foreground">
        No results for &ldquo;{q}&rdquo;.
      </p>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-6">
      {results.map((result) => (
        <li key={result.id}>
          <SearchResultCard result={result} />
        </li>
      ))}
    </ul>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <article className="flex gap-4">
      {/* Duplicate of the title link with no text of its own, same pattern
          as PostCard: hidden from the accessibility tree/tab order rather
          than announced twice. */}
      <Link
        href={`/posts/${result.slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block h-20 w-28 shrink-0 overflow-hidden rounded-md border sm:h-24 sm:w-36"
      >
        <ExternalImage src={result.thumbnailUrl} />
      </Link>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">
          {result.category.name}
        </p>
        <h2 className="mt-0.5 font-semibold leading-snug">
          <Link href={`/posts/${result.slug}`} className="hover:underline">
            {result.title}
          </Link>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          <time dateTime={result.publishAt.toISOString()}>
            {dateFormat.format(result.publishAt)}
          </time>
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          <SnippetText snippet={result.snippet} />
        </p>
      </div>
    </article>
  );
}

// Plain-text snippet with ts_headline's StartSel/StopSel markers (search.ts)
// rendered as <mark> — never dangerouslySetInnerHTML. Split on SNIPPET_START
// first (distinct from SNIPPET_END, so this doesn't get confused by nesting);
// each segment after the first starts with a matched span up to SNIPPET_END.
function SnippetText({ snippet }: { snippet: string }) {
  const [lead, ...matches] = snippet.split(SNIPPET_START);
  return (
    <>
      {lead}
      {matches.map((segment, i) => {
        const [matched, ...rest] = segment.split(SNIPPET_END);
        return (
          <span key={i}>
            <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
              {matched}
            </mark>
            {rest.join(SNIPPET_END)}
          </span>
        );
      })}
    </>
  );
}

function SearchPagination({
  params,
  hasMore,
}: {
  params: SearchPageParams;
  hasMore: boolean;
}) {
  if (!params.q) return null;
  if (params.page <= 1 && !hasMore) return null;

  function pageHref(page: number) {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.category) search.set("category", params.category);
    if (page > 1) search.set("page", String(page));
    const query = search.toString();
    return query ? `/search?${query}` : "/search";
  }

  return (
    <nav className="mt-8 flex items-center justify-between text-sm">
      {params.page > 1 ? (
        <Link href={pageHref(params.page - 1)} className="hover:underline">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      {hasMore ? (
        <Link href={pageHref(params.page + 1)} className="hover:underline">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function SearchSkeleton() {
  return (
    <div aria-busy="true" className="mt-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Skeleton className="h-8 min-w-40 flex-1" />
        <Skeleton className="h-8 w-32" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-20 w-28 shrink-0 rounded-md sm:h-24 sm:w-36" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
