// One source of truth for how rendered post HTML displays — the public post
// page and the ADM-2 editor preview must be pixel-identical (FR-7.2).
export function PostBody({ html }: { html: string }) {
  return (
    <div
      className="prose dark:prose-invert max-w-none"
      // Sanitized by rehype-sanitize in renderMarkdown (design §5.1).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
