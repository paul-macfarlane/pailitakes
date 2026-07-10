CREATE TABLE "post_drafts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"body_md" text NOT NULL,
	"thumbnail_url" text NOT NULL,
	"banner_url" text,
	"video_url" text,
	"category_id" integer NOT NULL,
	"tags" text[] NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill (ADR-0012): move any live staged snapshot from posts.draft (jsonb)
-- into the new normalized table before the source columns are dropped below.
-- Key casing matches writeStagedDraft's PostDraft snapshot shape verbatim
-- (camelCase jsonb keys — see src/lib/posts/input.ts's postDraftSchema).
INSERT INTO "post_drafts" ("post_id", "title", "slug", "body_md", "thumbnail_url", "banner_url", "video_url", "category_id", "tags", "updated_at")
SELECT
	"id",
	"draft"->>'title',
	"draft"->>'slug',
	"draft"->>'bodyMd',
	"draft"->>'thumbnailUrl',
	"draft"->>'bannerUrl',
	"draft"->>'videoUrl',
	("draft"->>'categoryId')::int,
	ARRAY(SELECT jsonb_array_elements_text("draft"->'tags')),
	COALESCE("draft_updated_at", now())
FROM "posts"
WHERE "draft" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "draft";--> statement-breakpoint
ALTER TABLE "posts" DROP COLUMN "draft_updated_at";