ALTER TYPE "public"."integration_provider" ADD VALUE 'housecall_pro';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_source_ref_uq" ON "tasks" USING btree ("user_id","source_ref") WHERE "tasks"."source_ref" is not null;