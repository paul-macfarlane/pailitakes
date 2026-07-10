"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { createPost, updatePost } from "@/actions/posts";
import { renderPostPreview } from "@/actions/preview";
import { ExternalImage } from "@/components/external-image";
import { LiteYouTubeActivation } from "@/components/lite-youtube-activation";
import { PostBody } from "@/components/post-body";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EditablePost } from "@/lib/admin-posts";
import {
  buildUpdateDiff,
  toActionInput,
  type EditorValues,
} from "@/lib/post-autosave";
import { httpsImageUrl, slugifyTitle } from "@/lib/post-input";
import { usesDraftBuffer } from "@/lib/post-status";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

// Splits the free-text tags field the same way toActionInput/buildUpdateDiff
// do, purely for client-side length/count validation.
function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

// "" (no image) or a STRICT https URL — reuses the server's httpsImageUrl
// (post-input.ts) so the client rejects the same scheme-only/malformed values
// the server would, keeping bad input out of the next/image preview and the
// save round-trip.
const optionalImageUrl = z.union([z.literal(""), httpsImageUrl]);

// A non-empty, valid https image URL. Used for the thumbnail when the post is
// already public: a published/scheduled post must keep a thumbnail (the
// server enforces this and rejects clearing it — ADM-5), so requiring it in
// the form turns that into an inline field error rather than a save the
// server refuses (which would otherwise wedge autosave — every subsequent
// diff re-sends the rejected "" and drags co-bundled edits down with it).
const requiredImageUrl = z
  .string()
  .refine((value) => httpsImageUrl.safeParse(value).success, {
    message: "A published or scheduled post needs an https:// thumbnail.",
  });

// True for a complete, previewable https image URL (not a half-typed one).
function isCompleteImageUrl(value: string): boolean {
  return value !== "" && httpsImageUrl.safeParse(value).success;
}

// Client-side UX validation only — createPost/updatePost re-validate on the
// server, which is the actual security boundary. `requiresThumbnail` mirrors
// the server's published/scheduled invariant (see requiredImageUrl).
function makeEditorFormSchema(requiresThumbnail: boolean) {
  return z.object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    // "" means "derive from title" (post-input.ts); anything else must
    // already be a valid slug.
    slug: z
      .string()
      .max(80)
      .refine(
        (value) => value === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
        { message: "Use lowercase letters, numbers, and hyphens." },
      ),
    categoryId: z.number().int().positive(),
    tags: z
      .string()
      .refine((value) => splitTags(value).length <= MAX_TAGS, {
        message: `Up to ${MAX_TAGS} tags.`,
      })
      .refine(
        (value) =>
          splitTags(value).every((tag) => tag.length <= MAX_TAG_LENGTH),
        { message: `Each tag must be ${MAX_TAG_LENGTH} characters or fewer.` },
      ),
    bodyMd: z.string().max(100_000),
    thumbnailUrl: requiresThumbnail ? requiredImageUrl : optionalImageUrl,
    bannerUrl: optionalImageUrl,
  });
}

// Same shape as EditorValues (post-autosave.ts) — both branches of
// makeEditorFormSchema infer thumbnailUrl as string.
type EditorFormValues = {
  title: string;
  slug: string;
  categoryId: number;
  tags: string;
  bodyMd: string;
  thumbnailUrl: string;
  bannerUrl: string;
};

const AUTOSAVE_INTERVAL_MS = 5000;

export function PostEditor({
  categories,
  initialPost,
  registerSave,
  onStatus,
}: {
  categories: { id: number; name: string }[];
  initialPost: EditablePost | null;
  // The Save action and autosave status render in the page heading (a sibling),
  // not in this form — so hand the current save fn up and bubble status changes.
  // All autosave logic (interval, diffing, CAS) stays here, untouched.
  registerSave: (save: () => void) => void;
  onStatus: (status: string, isError: boolean) => void;
}) {
  const defaultValues: EditorFormValues = initialPost
    ? {
        title: initialPost.title,
        slug: initialPost.slug,
        categoryId: initialPost.categoryId,
        tags: initialPost.tags.join(", "),
        bodyMd: initialPost.bodyMd,
        thumbnailUrl: initialPost.thumbnailUrl,
        bannerUrl: initialPost.bannerUrl ?? "",
      }
    : {
        title: "",
        slug: "",
        // New-post page only renders this editor once at least one category
        // exists (see src/app/admin/posts/new/page.tsx).
        categoryId: categories[0]!.id,
        tags: "",
        bodyMd: "",
        thumbnailUrl: "",
        bannerUrl: "",
      };

  // A post that's already public must keep a thumbnail (server invariant,
  // ADM-5). Derived from the initial status, which is stable for the editor's
  // lifetime — a status change happens via the sibling controls + a full
  // router.refresh, which is fine to reflect only on the next load.
  const requiresThumbnail =
    initialPost !== null &&
    (initialPost.status === "published" || initialPost.status === "scheduled");
  // On a public post, saves are STAGED into a draft buffer, not written live
  // (ADR-0011) — the server routes them there; the editor only reflects this in
  // its status label and by surfacing the "unpublished changes" banner.
  const stagesEdits =
    initialPost !== null && usesDraftBuffer(initialPost.status);
  const router = useRouter();
  const resolver = useMemo(
    () => standardSchemaResolver(makeEditorFormSchema(requiresThumbnail)),
    [requiresThumbnail],
  );

  const form = useForm<EditorFormValues>({
    resolver,
    defaultValues,
    mode: "onChange",
  });

  // Post id is mutated outside React's render cycle (the very first
  // autosave assigns one) — a ref avoids stale closures inside the
  // interval/save callback without forcing this to be reactive state.
  const postIdRef = useRef<string | null>(initialPost?.id ?? null);
  const lastSavedRef = useRef<EditorValues>(defaultValues);
  const savingRef = useRef(false);
  // Tracks whether the "unpublished changes" banner (a sibling server island)
  // is already showing, so the first staged save can reveal it via one
  // router.refresh — and no later save repeats it.
  const stagedRef = useRef(initialPost?.hasPendingChanges ?? false);
  // True once the author has typed into the slug field directly — guards
  // against a server-resolved slug (post-creation derivation, collision
  // retry) silently overwriting a deliberate manual choice.
  const slugManualRef = useRef(false);

  const [status, setStatus] = useState(
    initialPost ? "" : "Draft not saved yet",
  );
  const [statusIsError, setStatusIsError] = useState(false);

  const [mode, setMode] = useState<"write" | "preview">("write");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Caches which bodyMd string the current previewHtml corresponds to, so
  // toggling Write -> Preview -> Write -> Preview without editing the body
  // never re-calls the preview action.
  const previewedBodyMdRef = useRef<string | null>(null);

  const save = useCallback(async () => {
    if (savingRef.current) return;

    const values = form.getValues();
    const postId = postIdRef.current;

    let diff: Partial<ReturnType<typeof toActionInput>> | null = null;
    if (postId === null) {
      // Nothing worth persisting yet.
      if (values.title.trim() === "") return;
    } else {
      diff = buildUpdateDiff(lastSavedRef.current, values);
      if (Object.keys(diff).length === 0) return;
    }

    // Never save over unresolved validation errors. `formState.isValid` isn't
    // read during render, so react-hook-form doesn't keep it current (it only
    // recomputes subscribed state) — reading it here returns a stale `false`
    // that silently skips the first save. trigger() validates now and surfaces
    // any errors inline. Runs after the no-op checks so an untouched draft
    // doesn't flash required-field errors on the autosave tick.
    if (!(await form.trigger())) return;

    savingRef.current = true;
    setStatusIsError(false);
    setStatus("Saving…");

    try {
      const result =
        postId === null
          ? await createPost(toActionInput(values))
          : await updatePost(postId, diff!);

      if (!result.ok) {
        setStatusIsError(true);
        setStatus(result.error);
        return;
      }

      // The server may have adjusted the slug (title-derivation on create,
      // collision retry) — reflect it back into the field only if the
      // author hasn't manually set one themselves.
      let savedSlug = values.slug;
      if (!slugManualRef.current && result.data.slug !== values.slug) {
        form.setValue("slug", result.data.slug);
        savedSlug = result.data.slug;
      }
      lastSavedRef.current = { ...values, slug: savedSlug };

      if (postId === null) {
        postIdRef.current = result.data.id;
        // Swap the URL to the edit route without a navigation, so autosave
        // doesn't interrupt whatever the author is typing.
        window.history.replaceState(
          null,
          "",
          `/admin/posts/${result.data.id}/edit`,
        );
      }

      setStatusIsError(false);
      setStatus(
        `Saved${stagesEdits ? " to draft" : ""} ${new Date().toLocaleTimeString()}`,
      );

      // First staged edit on a public post created the draft buffer — reveal
      // the "unpublished changes" banner (a sibling server island) without a
      // manual reload. Once only; the soft refresh re-fetches the server tree
      // but leaves this editor's in-progress form state intact.
      if (stagesEdits && !stagedRef.current) {
        stagedRef.current = true;
        router.refresh();
      }
    } catch {
      // A rejected action call (network blip, server restart) must not
      // escape as an unhandled rejection from the autosave interval — and
      // the status line must not stay stuck on "Saving…".
      setStatusIsError(true);
      setStatus("Save failed — will retry.");
    } finally {
      savingRef.current = false;
    }
    // form is a stable object identity from useForm; everything else read
    // inside is a ref or read fresh via form.getValues()/formState. router and
    // stagesEdits are stable for the editor's lifetime.
  }, [form, router, stagesEdits]);

  useEffect(() => {
    const interval = setInterval(() => {
      void save();
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [save]);

  // Expose the save action + status to the heading toolbar (a sibling island).
  useEffect(() => {
    registerSave(() => void save());
  }, [registerSave, save]);
  useEffect(() => {
    onStatus(status, statusIsError);
  }, [onStatus, status, statusIsError]);

  const handlePreviewToggle = useCallback(async () => {
    setMode("preview");
    const bodyMd = form.getValues("bodyMd");
    if (previewedBodyMdRef.current === bodyMd && previewHtml !== null) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await renderPostPreview({ bodyMd });
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      previewedBodyMdRef.current = bodyMd;
      setPreviewHtml(result.data.html);
    } catch {
      // Same rejection guard as save(): keep the failure inside the pane.
      setPreviewError("Preview failed. Try again.");
    } finally {
      setPreviewLoading(false);
    }
  }, [form, previewHtml]);

  const titleValue = form.watch("title");
  const thumbnailValue = form.watch("thumbnailUrl");
  const bannerValue = form.watch("bannerUrl");
  const { errors } = form.formState;

  return (
    <form
      onSubmit={form.handleSubmit(() => {
        void save();
      })}
      className="flex flex-col gap-6"
    >
      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="title">Title</FieldLabel>
        <Input
          id="title"
          aria-invalid={errors.title ? true : undefined}
          {...form.register("title")}
        />
        {errors.title ? <FieldError>{errors.title.message}</FieldError> : null}
      </Field>

      <Field data-invalid={errors.slug ? true : undefined}>
        <FieldLabel htmlFor="slug">Slug</FieldLabel>
        <Input
          id="slug"
          placeholder={slugifyTitle(titleValue)}
          aria-invalid={errors.slug ? true : undefined}
          {...form.register("slug", {
            onChange: () => {
              slugManualRef.current = true;
            },
          })}
        />
        <FieldDescription>
          Leave blank to derive from the title.
        </FieldDescription>
        {errors.slug ? <FieldError>{errors.slug.message}</FieldError> : null}
      </Field>

      <Field data-invalid={errors.categoryId ? true : undefined}>
        <FieldLabel htmlFor="category">Category</FieldLabel>
        <Controller
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <Select
              // Lets SelectValue render the category name when the popup is
              // closed — without it, Base UI shows the raw numeric id.
              items={categories.map((category) => ({
                label: category.name,
                value: category.id,
              }))}
              value={field.value}
              onValueChange={(value) => field.onChange(value)}
            >
              <SelectTrigger
                id="category"
                className="w-full"
                aria-invalid={errors.categoryId ? true : undefined}
              >
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.categoryId ? (
          <FieldError>{errors.categoryId.message}</FieldError>
        ) : null}
      </Field>

      <Field data-invalid={errors.tags ? true : undefined}>
        <FieldLabel htmlFor="tags">Tags</FieldLabel>
        <Input
          id="tags"
          aria-invalid={errors.tags ? true : undefined}
          {...form.register("tags")}
        />
        <FieldDescription>Comma-separated, up to 10.</FieldDescription>
        {errors.tags ? <FieldError>{errors.tags.message}</FieldError> : null}
      </Field>

      {/* Thumbnail is required before a post can be published/scheduled
          (server-enforced); banner is the optional post-page hero (POST-9,
          falls back to the thumbnail). Video URL stays out of this editor. */}
      <Field data-invalid={errors.thumbnailUrl ? true : undefined}>
        <FieldLabel htmlFor="thumbnailUrl">Thumbnail URL</FieldLabel>
        <Input
          id="thumbnailUrl"
          type="url"
          inputMode="url"
          placeholder="https://…"
          aria-invalid={errors.thumbnailUrl ? true : undefined}
          {...form.register("thumbnailUrl")}
        />
        <FieldDescription>
          Public image URL (https). Shown on cards and previews; required to
          publish.
        </FieldDescription>
        {errors.thumbnailUrl ? (
          <FieldError>{errors.thumbnailUrl.message}</FieldError>
        ) : null}
        {isCompleteImageUrl(thumbnailValue) ? (
          <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
            <ExternalImage src={thumbnailValue} alt="Thumbnail preview" />
          </div>
        ) : null}
      </Field>

      <Field data-invalid={errors.bannerUrl ? true : undefined}>
        <FieldLabel htmlFor="bannerUrl">Banner URL</FieldLabel>
        <Input
          id="bannerUrl"
          type="url"
          inputMode="url"
          placeholder="https://…"
          aria-invalid={errors.bannerUrl ? true : undefined}
          {...form.register("bannerUrl")}
        />
        <FieldDescription>
          Optional hero image for the post page. Falls back to the thumbnail
          when blank.
        </FieldDescription>
        {errors.bannerUrl ? (
          <FieldError>{errors.bannerUrl.message}</FieldError>
        ) : null}
        {isCompleteImageUrl(bannerValue) ? (
          <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-lg border bg-muted">
            <ExternalImage src={bannerValue} alt="Banner preview" />
          </div>
        ) : null}
      </Field>

      <Field data-invalid={errors.bodyMd ? true : undefined}>
        <FieldLabel htmlFor="bodyMd">Body</FieldLabel>
        <div role="group" aria-label="Body view" className="flex gap-2">
          <Button
            type="button"
            variant={mode === "write" ? "secondary" : "ghost"}
            aria-pressed={mode === "write"}
            onClick={() => setMode("write")}
          >
            Write
          </Button>
          <Button
            type="button"
            variant={mode === "preview" ? "secondary" : "ghost"}
            aria-pressed={mode === "preview"}
            onClick={() => void handlePreviewToggle()}
          >
            Preview
          </Button>
        </div>
        {mode === "write" ? (
          <Textarea
            id="bodyMd"
            rows={16}
            className="font-mono text-sm"
            aria-invalid={errors.bodyMd ? true : undefined}
            {...form.register("bodyMd")}
          />
        ) : (
          <div className="min-h-64 rounded-lg border p-4">
            {/* Registers the <lite-youtube> custom element so any embed in
                the previewed body activates, mirroring the public post page. */}
            <LiteYouTubeActivation />
            {previewLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Rendering…
              </p>
            ) : null}
            {previewError ? (
              <p role="alert" className="text-sm text-destructive">
                {previewError}
              </p>
            ) : null}
            {!previewLoading && !previewError && previewHtml !== null ? (
              <PostBody html={previewHtml} />
            ) : null}
          </div>
        )}
        {errors.bodyMd ? (
          <FieldError>{errors.bodyMd.message}</FieldError>
        ) : null}
      </Field>
    </form>
  );
}
