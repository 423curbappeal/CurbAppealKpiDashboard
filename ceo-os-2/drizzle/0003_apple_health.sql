CREATE TABLE "ingest_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_four" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_payload_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "focus" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "energy_kcal" integer;--> statement-breakpoint
ALTER TABLE "ingest_tokens" ADD CONSTRAINT "ingest_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_tokens" ADD CONSTRAINT "ingest_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_tokens_user_idx" ON "ingest_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_user_external_uq" ON "activities" USING btree ("user_id","external_id") WHERE "activities"."external_id" is not null;