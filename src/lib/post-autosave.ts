// Pure mapping helpers for the ADM-2 editor's autosave/manual-save flow. No
// "server-only" here — unit-tested directly, and the editor island (a client
// component) imports these too.

export type EditorValues = {
  title: string;
  slug: string;
  categoryId: number;
  tags: string;
  bodyMd: string;
  // URL text fields (ADM-6). Empty string = "no image": thumbnail keeps ""
  // (its column is not-null, "" is the draft placeholder), banner maps to
  // null (its column is nullable).
  thumbnailUrl: string;
  bannerUrl: string;
};

type ActionInput = {
  title: string;
  slug?: string;
  categoryId: number;
  tags: string[];
  bodyMd: string;
  thumbnailUrl?: string;
  bannerUrl?: string | null;
};

// Banner column is nullable and its schema rejects "" — an empty field is
// "no banner" (null). Thumbnail keeps "" as-is (its own union accepts it).
function bannerToInput(value: string): string | null {
  return value === "" ? null : value;
}

// Tag names as free text ("a, b, c") -> the array shape createPost/
// updatePost expect. Dedupe is the server's job (setPostTags); this only
// splits, trims, and drops empties.
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

// Form values -> the createPost/updatePost input shape. An empty slug field
// means "derive from title" (postInputSchema/postUpdateSchema contract), so
// it's omitted rather than sent as "".
export function toActionInput(values: EditorValues): ActionInput {
  const input: ActionInput = {
    title: values.title.trim(),
    categoryId: values.categoryId,
    tags: parseTags(values.tags),
    bodyMd: values.bodyMd,
    thumbnailUrl: values.thumbnailUrl,
    bannerUrl: bannerToInput(values.bannerUrl),
  };
  if (values.slug !== "") {
    input.slug = values.slug;
  }
  return input;
}

// Diffs two RAW EditorValues snapshots (not the mapped action input) and
// returns only the mapped fields that changed — absent keys mean "leave
// unchanged" per postUpdateSchema (ADM-3). Returns {} when nothing changed,
// so callers can skip a no-op save.
export function buildUpdateDiff(
  prev: EditorValues,
  next: EditorValues,
): Partial<ActionInput> {
  const diff: Partial<ActionInput> = {};

  if (prev.title !== next.title) {
    diff.title = next.title.trim();
  }

  // Clearing the slug field back to "" doesn't derive a new slug on update
  // (there's no title-derivation retry path for updates, unlike create) — it
  // just stops any future manual override from being sent, so the key is
  // omitted rather than included as "".
  if (prev.slug !== next.slug && next.slug !== "") {
    diff.slug = next.slug;
  }

  if (prev.categoryId !== next.categoryId) {
    diff.categoryId = next.categoryId;
  }

  if (prev.tags !== next.tags) {
    diff.tags = parseTags(next.tags);
  }

  if (prev.bodyMd !== next.bodyMd) {
    diff.bodyMd = next.bodyMd;
  }

  if (prev.thumbnailUrl !== next.thumbnailUrl) {
    diff.thumbnailUrl = next.thumbnailUrl;
  }

  if (prev.bannerUrl !== next.bannerUrl) {
    diff.bannerUrl = bannerToInput(next.bannerUrl);
  }

  return diff;
}
