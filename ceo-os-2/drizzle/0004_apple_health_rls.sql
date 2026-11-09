-- Personal ingest tokens: same tenant isolation as other domain tables.
ALTER TABLE ingest_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ingest_tokens TO ceo_os_app;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ingest_tokens
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid
         AND user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid
         AND user_id = nullif(current_setting('app.user_id', true), ''));
