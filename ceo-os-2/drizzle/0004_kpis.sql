ALTER TYPE "public"."goal_metric" ADD VALUE 'depop_profit' BEFORE 'manual';--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "metrics" jsonb;