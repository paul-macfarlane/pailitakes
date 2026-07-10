// Markdown rendering pipeline (design §5.1, locked order):
//   remark-parse -> remark-gfm -> remark-rehype -> rehype-sanitize
//   -> custom YouTube embed transform -> rehype-pretty-code -> rehype-stringify
//
// Runs server-side (post page RSC, captured by ISR) but has no server-only
// import: the pipeline is pure and the editor preview island (later epic)
// may reuse pieces of it client-side.

import type { Element, Root } from "hast";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function idFromPathPrefix(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  return YOUTUBE_ID_RE.test(rest) ? rest : null;
}

// Extracts the 11-char video id from any of the accepted YouTube URL forms,
// or returns null (invalid URL, disallowed host, bad id). http is accepted
// alongside https because remark-gfm autolinks a schemeless `www.youtube.com/
// watch?v=...` paste with an http:// href — recognition never echoes the
// original scheme; the embed we emit is always our own https nocookie URL.
// Hosts are matched exactly by the switch (its default rejects everything
// else) — never a `.endsWith("youtube.com")`-style suffix check, which a
// lookalike host (e.g. `evilyoutube.com`) would pass.
export function extractYouTubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  switch (parsed.hostname) {
    case "youtube.com":
    case "www.youtube.com":
    case "m.youtube.com": {
      // m.youtube.com: the mobile-web address bar — authors paste from
      // phones (FR-9.4 mobile-first applies to authors too).
      if (parsed.pathname === "/watch") {
        const v = parsed.searchParams.get("v");
        return v !== null && YOUTUBE_ID_RE.test(v) ? v : null;
      }
      return (
        idFromPathPrefix(parsed.pathname, "/shorts/") ??
        idFromPathPrefix(parsed.pathname, "/live/") ??
        idFromPathPrefix(parsed.pathname, "/embed/")
      );
    }
    case "youtu.be":
    case "www.youtu.be":
      return idFromPathPrefix(parsed.pathname, "/");
    case "youtube-nocookie.com":
    case "www.youtube-nocookie.com":
      return idFromPathPrefix(parsed.pathname, "/embed/");
    default:
      return null;
  }
}

// Extends defaultSchema (GitHub-style sanitation) rather than replacing it,
// so `code`'s `language-*` className pattern (needed by rehype-pretty-code
// downstream) and everything else GFM relies on stays intact. The
// lite-youtube entries mirror exactly what youtubeEmbedNode emits, nothing
// more (value-scoped classNames so no other class rides along); the strip
// pass below is what enforces the videoid shape.
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "lite-youtube"],
  attributes: {
    ...defaultSchema.attributes,
    "lite-youtube": [
      ["className", "youtube-embed"],
      "videoid",
      "title",
      "playlabel",
    ],
    a: [...(defaultSchema.attributes?.a ?? []), ["className", "lyt-playbtn"]],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", "lyt-visually-hidden"],
    ],
  },
};

// Builds the hast nodes for a YouTube embed (as real nodes, not raw HTML —
// raw HTML is dropped at the remark-rehype step by design): the lite-youtube
// click-to-load facade (design §5.1 — eager YouTube iframes wreck mobile
// load performance). The custom element upgrades client-side via
// LiteYouTubeActivation (src/components/lite-youtube-activation.tsx) and
// only loads the real youtube-nocookie.com player when tapped; the anchor
// child is the no-JS fallback, which lite-youtube converts to the play
// button once active.
function youtubeEmbedNode(id: string): Element {
  return {
    type: "element",
    tagName: "lite-youtube",
    properties: {
      className: ["youtube-embed"],
      videoid: id,
      title: "YouTube video",
    },
    children: [
      {
        type: "element",
        tagName: "a",
        properties: {
          className: ["lyt-playbtn"],
          href: `https://www.youtube.com/watch?v=${id}`,
        },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["lyt-visually-hidden"] },
            children: [{ type: "text", value: "Play video" }],
          },
        ],
      },
    ],
  };
}

// True when the element's ONLY child is a bare-URL autolink to a YouTube
// video; returns the video id. remark-gfm turns a pasted bare URL into a
// link whose text equals its href (an "autolink") — that equality is exactly
// what distinguishes it from a labelled link (`[watch this](url)`, text !==
// href) or a URL inline in a longer sentence (element has >1 child), both of
// which are left as ordinary links.
function bareYouTubeAutolinkId(node: Element): string | null {
  if (node.children.length !== 1) return null;
  const [link] = node.children;
  if (link.type !== "element" || link.tagName !== "a") return null;

  const href = link.properties?.href;
  if (typeof href !== "string") return null;

  const id = extractYouTubeId(href);
  if (!id) return null;

  // gfm's www-autolink (`www.youtube.com/...` pasted schemeless) keeps the
  // bare text but prepends http:// to the href — still an autolink.
  // Deliberate: `[same-url](same-url)` labelled links also match — they're
  // indistinguishable from a paste at this level and render identically, so
  // they embed too; a label that differs from the URL opts out.
  const [linkText] = link.children;
  const isAutolink =
    link.children.length === 1 &&
    linkText.type === "text" &&
    (linkText.value === href || `http://${linkText.value}` === href);
  return isAutolink ? id : null;
}

// Replaces bare-URL YouTube autolinks with a responsive embed in the two
// shapes authors produce: a paragraph of its own (replace the whole <p> —
// a div inside <p> is invalid HTML), and a tight list item (`- <url>`),
// where remark emits the autolink as a direct child of <li> with no <p>
// wrapper (replace the link, keeping the <li>). Loose list items wrap the
// autolink in a <p> inside the <li>, which the paragraph branch handles.
function rehypeYouTubeEmbeds() {
  return (tree: Root): void => {
    visit(tree, "element", (node, index, parent) => {
      if (parent === undefined || index === undefined) return;

      if (node.tagName === "p") {
        const id = bareYouTubeAutolinkId(node);
        if (id) parent.children[index] = youtubeEmbedNode(id);
      } else if (node.tagName === "li") {
        const id = bareYouTubeAutolinkId(node);
        if (id) node.children = [youtubeEmbedNode(id)];
      }
    });
  };
}

// Belt-and-suspenders on top of the sanitize schema above: with raw HTML
// dropped at the remark-rehype step, embeds can only ever originate from
// rehypeYouTubeEmbeds, so this is a no-op today — but it keeps the allowlist
// meaningful (and this pass is what actually enforces it) if that ever
// changes, e.g. someone later enables raw HTML passthrough. The pipeline
// emits NO iframes server-side (the facade upgrades client-side), so every
// iframe is stripped; lite-youtube elements must carry a valid 11-char id.
function rehypeStripDisallowedEmbeds() {
  return (tree: Root): void => {
    visit(tree, "element", (node, index, parent) => {
      if (parent === undefined || index === undefined) return;

      const videoid = node.properties?.videoid;
      const disallowed =
        node.tagName === "iframe" ||
        (node.tagName === "lite-youtube" &&
          !(typeof videoid === "string" && YOUTUBE_ID_RE.test(videoid)));
      if (!disallowed) return;

      parent.children.splice(index, 1);
      // Re-visit the same index — the next sibling shifted into it, and
      // falling through would skip it (e.g. two adjacent bad embeds).
      return index;
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // Defaults: raw HTML in the markdown source is dropped (not passed
  // through), which is the design intent — authors write markdown, not HTML.
  .use(remarkRehype)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeYouTubeEmbeds)
  .use(rehypeStripDisallowedEmbeds)
  // Dual-theme (light/dark) CSS-variable output so the site's theme toggle
  // works without a second render; page CSS wiring lands with POST-5. This
  // version's Options type exposes a single `theme` key that accepts either
  // one theme name or a `{ [name]: theme }` record for multi-theme output —
  // passing the record is equivalent to the `themes` + `defaultColor: false`
  // shape from newer rehype-pretty-code releases (defaultColor is inferred
  // `false` automatically whenever `theme` is an object).
  .use(rehypePrettyCode, {
    theme: { light: "github-light", dark: "github-dark" },
    keepBackground: false,
  })
  .use(rehypeStringify);

// Renders markdown to sanitized HTML. Built once at module scope and reused
// across calls (unified processors are expensive to construct, cheap to run).
export async function renderMarkdown(md: string): Promise<string> {
  // Emptiness check only — never trim what we parse: a post starting with a
  // 4-space-indented code block loses its first line's indent to trim().
  if (md.trim() === "") return "";

  const file = await processor.process(md);
  return String(file);
}
