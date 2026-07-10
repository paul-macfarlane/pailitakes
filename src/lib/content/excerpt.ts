import { toString as mdastToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// Excerpts are derived, never stored (design §4): strip markdown from
// body_md, ~160 chars. Parsing to mdast (instead of regex-stripping) keeps
// this robust against truncated input — list queries feed the first 1000
// chars of body_md (posts.ts excerptSource), which can cut a construct
// mid-token, and remark parses any garbage without throwing.
const parser = unified().use(remarkParse).use(remarkGfm);

// A block that is just a pasted URL (e.g. a bare YouTube link that renders
// as an embed) contributes nothing readable to an excerpt.
const BARE_URL_RE = /^(https?:\/\/|www\.)\S+$/;

// A link/image cut mid-construct by the excerptSource truncation parses as
// literal text (remark doesn't throw, it just keeps the broken syntax) —
// drop an unclosed `[label` / `[label](dest` fragment from the tail.
// Complete constructs end in `)` and never match. Only applied when the
// caller says the source was actually truncated: on a full body, a trailing
// bracket fragment is real authored prose, not an artifact.
const TRUNCATED_LINK_TAIL_RE = /!?\[[^\]]*(\]\([^)]*)?$/;

export const EXCERPT_MAX_LENGTH = 160;

export function deriveExcerpt(
  bodyMd: string,
  {
    maxLength = EXCERPT_MAX_LENGTH,
    sourceTruncated = false,
  }: { maxLength?: number; sourceTruncated?: boolean } = {},
): string {
  if (bodyMd.trim() === "") return "";

  const source = sourceTruncated
    ? bodyMd.replace(TRUNCATED_LINK_TAIL_RE, "")
    : bodyMd;
  // When the tail regex removed a cut construct, what remains ends at a
  // clean token boundary — the final-word drop below would eat real prose.
  const tailStripped = source !== bodyMd;

  const tree = parser.parse(source);
  const parts: string[] = [];
  let length = 0;
  let consumedAll = true;

  for (const node of tree.children) {
    // Code and raw HTML aren't prose; skip rather than excerpt them.
    if (node.type === "code" || node.type === "html") continue;

    const text = mdastToString(node).replace(/\s+/g, " ").trim();
    if (text === "" || BARE_URL_RE.test(text)) continue;

    parts.push(text);
    length += text.length;
    if (length >= maxLength) {
      consumedAll = false;
      break;
    }
  }

  const joined = parts.join(" ");
  if (joined.length <= maxLength) {
    // A truncated source that we consumed to its end may cut the final word
    // mid-token (left(body_md, N) stops wherever N lands) — drop that word
    // and show the cut honestly. Skip the drop when the tail-strip already
    // removed the artifact; just mark the cut.
    if (sourceTruncated && consumedAll && joined !== "") {
      if (tailStripped) return `${joined.trimEnd()}…`;
      const lastSpace = joined.lastIndexOf(" ");
      return lastSpace > 0
        ? `${joined.slice(0, lastSpace).trimEnd()}…`
        : joined;
    }
    return joined;
  }

  const cut = joined.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
