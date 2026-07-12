// Comment bodies are plain text (FR-4.5/design D11): markdown/HTML is never
// rendered, but bare URLs are still auto-linked. This is a pure segmenter —
// the caller (comment-item.tsx) maps segments to JSX, where plain-text
// segments render as ordinary text nodes (escape-by-default, no
// dangerouslySetInnerHTML anywhere in the render path) and url segments
// become `<a rel="nofollow ugc noopener noreferrer" target="_blank">`
// (design §8) — noopener/noreferrer close the reverse-tabnabbing hole that
// `target="_blank"` alone leaves open on UGC links.

export type CommentBodySegment =
  { type: "text"; value: string } | { type: "url"; value: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;

// Trailing punctuation almost never belongs to the URL itself ("see
// https://x.com." or "(https://x.com)") — stripped so the link doesn't
// swallow it, same spirit as remark-gfm's own autolink extension (src/lib/
// content/markdown.ts).
const TRAILING_PUNCTUATION_RE = /[.,!?;:)\]}'"]+$/;

// A trailing ")" is kept when the URL itself contains an unmatched "(" (e.g.
// a Wikipedia-style URL) — a shallow balance check, not a full parser.
function trimTrailingPunctuation(raw: string): string {
  const trailing = raw.match(TRAILING_PUNCTUATION_RE)?.[0];
  if (!trailing) return raw;

  // opens >= closes means every "(" already has a matching ")" — the
  // trailing ")" closes one of THOSE, so it's part of the URL (e.g. a
  // Wikipedia "Foo_(bar)" path). closes > opens means there's an
  // unmatched closing paren, almost always sentence punctuation wrapping
  // the URL (e.g. "(see https://x.com)").
  const opens = (raw.match(/\(/g) ?? []).length;
  const closes = (raw.match(/\)/g) ?? []).length;
  if (trailing === ")" && opens >= closes) return raw;

  return raw.slice(0, raw.length - trailing.length);
}

export function linkifyText(text: string): CommentBodySegment[] {
  const segments: CommentBodySegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    const raw = match[0];
    const url = trimTrailingPunctuation(raw);
    const end = start + raw.length;

    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    segments.push({ type: "url", value: url });
    if (url.length < raw.length) {
      segments.push({
        type: "text",
        value: text.slice(start + url.length, end),
      });
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
