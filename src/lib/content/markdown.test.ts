import { describe, expect, it } from "vitest";

import { extractYouTubeId, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  describe("GFM", () => {
    it("renders a table", async () => {
      const html = await renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |\n");
      expect(html).toContain("<table>");
    });

    it("renders strikethrough as <del>", async () => {
      expect(await renderMarkdown("~~gone~~")).toContain("<del>gone</del>");
    });

    it("renders a task list as disabled checkboxes", async () => {
      const html = await renderMarkdown("- [ ] todo\n- [x] done\n");
      expect(html).toContain('type="checkbox"');
      expect(html).toContain("disabled");
      expect(html).toContain("checked");
    });
  });

  describe("sanitization", () => {
    it("drops <script> tags entirely", async () => {
      const html = await renderMarkdown("<script>alert(1)</script>\n\nHello");
      expect(html).not.toContain("<script");
      expect(html).toContain("Hello");
    });

    it("drops raw HTML (e.g. <img onerror>) rather than passing it through", async () => {
      const html = await renderMarkdown('<img src=x onerror="alert(1)">');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("onerror");
    });

    it("strips a javascript: link href", async () => {
      const html = await renderMarkdown("[click](javascript:alert(1))");
      expect(html).not.toContain("javascript:");
      expect(html).toContain("click");
    });

    it("never lets a non-YouTube iframe through", async () => {
      const html = await renderMarkdown(
        '<iframe src="https://evil.example/embed/x"></iframe>',
      );
      expect(html).not.toContain("<iframe");
    });
  });

  describe("YouTube embed transform", () => {
    // The emitted embed is the lite-youtube click-to-load facade (design
    // §5.1); no iframe exists server-side. The <a class="lyt-playbtn"> child
    // is the no-JS fallback, so "stays a link" cases assert the absence of
    // <lite-youtube>, not of <a>.
    const FACADE = '<lite-youtube class="youtube-embed" videoid="dQw4w9WgXcQ"';
    const FALLBACK =
      '<a class="lyt-playbtn" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">';

    it("embeds a bare youtube.com/watch URL", async () => {
      const html = await renderMarkdown(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(html).toContain(FACADE);
      expect(html).toContain(FALLBACK);
      expect(html).not.toContain("<iframe");
    });

    it("embeds a bare youtu.be URL", async () => {
      const html = await renderMarkdown("https://youtu.be/dQw4w9WgXcQ");
      expect(html).toContain(FACADE);
    });

    it("leaves a labelled link as an ordinary <a>", async () => {
      const html = await renderMarkdown(
        "[great video](https://youtu.be/dQw4w9WgXcQ)",
      );
      expect(html).not.toContain("<lite-youtube");
      expect(html).toContain(
        '<a href="https://youtu.be/dQw4w9WgXcQ">great video</a>',
      );
    });

    it("leaves a URL inline in a longer sentence as an ordinary link", async () => {
      const html = await renderMarkdown(
        "Check this out https://youtu.be/dQw4w9WgXcQ it's great",
      );
      expect(html).not.toContain("<lite-youtube");
      expect(html).toContain('<a href="https://youtu.be/dQw4w9WgXcQ">');
    });

    it("embeds a schemeless www.youtube.com paste (gfm autolinks it as http://)", async () => {
      const html = await renderMarkdown("www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(html).toContain(FACADE);
    });

    it("embeds bare URLs in tight list items (autolink is a direct <li> child)", async () => {
      const html = await renderMarkdown(
        "- https://youtu.be/dQw4w9WgXcQ\n- https://youtu.be/abcdefghijk",
      );
      expect(html).toContain(`<li>${FACADE}`);
      expect(html).toContain('videoid="abcdefghijk"');
      // The original autolinks are gone; only watch-URL fallbacks remain.
      expect(html).not.toContain('href="https://youtu.be/');
    });

    it("embeds bare URLs in loose list items (autolink wrapped in <p>)", async () => {
      const html = await renderMarkdown(
        "- https://youtu.be/dQw4w9WgXcQ\n\n- https://youtu.be/abcdefghijk",
      );
      expect(html).toContain('videoid="dQw4w9WgXcQ"');
      expect(html).toContain('videoid="abcdefghijk"');
      expect(html).not.toContain('href="https://youtu.be/');
    });

    it("leaves a labelled link in a list item as an ordinary <a>", async () => {
      const html = await renderMarkdown(
        "- [great video](https://youtu.be/dQw4w9WgXcQ)",
      );
      expect(html).not.toContain("<lite-youtube");
      expect(html).toContain("great video</a>");
    });
  });

  describe("code blocks", () => {
    it("highlights a fenced block with a language", async () => {
      const html = await renderMarkdown("```js\nconst x = 1;\n```");
      expect(html).toContain("<pre");
      expect(html).toContain("<code");
      expect(html).toMatch(/data-|<span/);
    });

    it("still renders a fenced block with no language", async () => {
      const html = await renderMarkdown("```\nplain text\n```");
      expect(html).toContain("<pre><code>");
      expect(html).toContain("plain text");
    });

    it("preserves a leading 4-space-indented code block (input is not trimmed)", async () => {
      const html = await renderMarkdown(
        "    const x = 1;\n    const y = 2;\n\nAfter.",
      );
      expect(html).toContain("<pre");
      expect(html).toContain("const x = 1;");
      expect(html).not.toContain("<p>const x = 1;");
    });
  });

  describe("empty input", () => {
    it("returns an empty string for empty input", async () => {
      expect(await renderMarkdown("")).toBe("");
    });

    it("returns an empty string for whitespace-only input", async () => {
      expect(await renderMarkdown("  \n ")).toBe("");
    });
  });

  describe("headings and links baseline", () => {
    it("renders a heading", async () => {
      expect(await renderMarkdown("# Hi")).toContain("<h1>Hi</h1>");
    });

    it("keeps a normal https link with its href intact", async () => {
      const html = await renderMarkdown("[go](https://example.com/x)");
      expect(html).toContain('<a href="https://example.com/x">go</a>');
    });
  });
});

describe("extractYouTubeId", () => {
  const VIDEO_ID = "dQw4w9WgXcQ";

  it.each([
    ["youtube.com/watch?v=", `https://www.youtube.com/watch?v=${VIDEO_ID}`],
    [
      "youtube.com/watch?v= (no www)",
      `https://youtube.com/watch?v=${VIDEO_ID}`,
    ],
    [
      "youtube.com/watch?v= with extra query params",
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=10s`,
    ],
    ["youtu.be/", `https://youtu.be/${VIDEO_ID}`],
    ["youtu.be/ (with www)", `https://www.youtu.be/${VIDEO_ID}`],
    [
      "m.youtube.com/watch?v= (mobile web)",
      `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    ],
    ["youtube.com/live/", `https://www.youtube.com/live/${VIDEO_ID}`],
    ["youtube.com/shorts/", `https://www.youtube.com/shorts/${VIDEO_ID}`],
    ["youtube.com/shorts/ (no www)", `https://youtube.com/shorts/${VIDEO_ID}`],
    ["youtube.com/embed/", `https://www.youtube.com/embed/${VIDEO_ID}`],
    [
      "youtube-nocookie.com/embed/",
      `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
    ],
    [
      "youtube-nocookie.com/embed/ (no www)",
      `https://youtube-nocookie.com/embed/${VIDEO_ID}`,
    ],
  ])("accepts %s", (_label, url) => {
    expect(extractYouTubeId(url)).toBe(VIDEO_ID);
  });

  it("rejects a lookalike host", () => {
    expect(
      extractYouTubeId(`https://evilyoutube.com/watch?v=${VIDEO_ID}`),
    ).toBeNull();
  });

  it("accepts http URLs (gfm autolinks schemeless www. pastes as http://)", () => {
    expect(extractYouTubeId(`http://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(
      VIDEO_ID,
    );
  });

  it("rejects non-http(s) protocols", () => {
    expect(
      extractYouTubeId(`ftp://www.youtube.com/watch?v=${VIDEO_ID}`),
    ).toBeNull();
  });

  it("rejects an invalid id length", () => {
    expect(extractYouTubeId("https://youtu.be/short")).toBeNull();
  });

  it("rejects a garbage string", () => {
    expect(extractYouTubeId("not a url")).toBeNull();
  });
});
