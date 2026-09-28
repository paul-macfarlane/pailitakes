CREATE TABLE "post_collaborators" (
	"post_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "post_collaborators_post_id_user_id_pk" PRIMARY KEY("post_id","user_id"),
	CONSTRAINT "post_collaborators_role_check" CHECK ("post_collaborators"."role" in ('reviewer', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "post_collaborators" ADD CONSTRAINT "post_collaborators_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_collaborators" ADD CONSTRAINT "post_collaborators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_collaborators_user_idx" ON "post_collaborators" USING btree ("user_id");