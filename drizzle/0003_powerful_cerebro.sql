CREATE TABLE "revalidation_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL
);
