CREATE TABLE "depop_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"brand" text,
	"size" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"list_price_cents" integer,
	"listed_on" date NOT NULL,
	"sold_on" date,
	"sale_price_cents" integer,
	"fees_cents" integer,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "depop_items" ADD CONSTRAINT "depop_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depop_items" ADD CONSTRAINT "depop_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "depop_items_org_user_idx" ON "depop_items" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "depop_items_user_sold_idx" ON "depop_items" USING btree ("user_id","sold_on");--> statement-breakpoint
-- Row-level security, same policy as every other domain table (see 0001_rls.sql).
ALTER TABLE "depop_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "depop_items" TO ceo_os_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "depop_items"
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid
         AND user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid
         AND user_id = nullif(current_setting('app.user_id', true), ''));
