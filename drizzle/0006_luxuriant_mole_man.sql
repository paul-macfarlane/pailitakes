ALTER TABLE "posts" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "draft_updated_at" timestamp with time zone;