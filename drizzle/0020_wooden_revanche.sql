CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"change_id" text,
	"anchor" jsonb,
	"parent_id" uuid,
	"author_id" text,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "review_comments_reply_check" CHECK ("review_comments"."parent_id" is null OR ("review_comments"."change_id" is null AND "review_comments"."anchor" is null AND "review_comments"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "review_drafts" (
	"post_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"source_version" uuid NOT NULL,
	"source_is_public" boolean NOT NULL,
	"base" jsonb NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"general_feedback" text DEFAULT '' NOT NULL,
	"previous" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replaces_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_drafts_post_id_reviewer_id_pk" PRIMARY KEY("post_id","reviewer_id")
);
--> statement-breakpoint
ALTER TABLE "edit_proposals" DROP CONSTRAINT "edit_proposals_origin_check";--> statement-breakpoint
ALTER TABLE "edit_proposals" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edit_proposals" ALTER COLUMN "agent_label" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edit_proposals" ALTER COLUMN "skill" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD COLUMN "reviewer_id" text;--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD COLUMN "reviewer_name" text;--> statement-breakpoint
ALTER TABLE "post_collaborators" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_proposal_id_edit_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."edit_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_parent_id_review_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."review_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_drafts" ADD CONSTRAINT "review_drafts_replaces_proposal_id_edit_proposals_id_fk" FOREIGN KEY ("replaces_proposal_id") REFERENCES "public"."edit_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comments_proposal_idx" ON "review_comments" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "review_drafts_reviewer_idx" ON "review_drafts" USING btree ("reviewer_id");--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edit_proposals_reviewer_idx" ON "edit_proposals" USING btree ("reviewer_id","post_id");--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_attribution_check" CHECK (("edit_proposals"."origin" = 'agent' AND "edit_proposals"."agent_id" is not null AND "edit_proposals"."agent_label" is not null AND "edit_proposals"."skill" is not null) OR ("edit_proposals"."origin" = 'human' AND "edit_proposals"."reviewer_name" is not null));--> statement-breakpoint
ALTER TABLE "edit_proposals" ADD CONSTRAINT "edit_proposals_origin_check" CHECK ("edit_proposals"."origin" in ('agent', 'human'));