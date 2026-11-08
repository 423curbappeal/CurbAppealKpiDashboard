-- Row-level security: defense in depth for tenant isolation.
-- The application switches to the restricted role `ceo_os_app` (SET LOCAL ROLE)
-- inside every tenant transaction, after setting app.org_id / app.user_id.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ceo_os_app') THEN
    CREATE ROLE ceo_os_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT ceo_os_app TO %I', current_user);
EXCEPTION WHEN others THEN NULL;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ceo_os_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','routines','routine_completions','activities','goals','integrations','calendar_events','weekly_reviews']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ceo_os_app', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid
             AND user_id = nullif(current_setting('app.user_id', true), ''))
      WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid
             AND user_id = nullif(current_setting('app.user_id', true), ''))$p$, t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO ceo_os_app;
--> statement-breakpoint
CREATE POLICY audit_tenant_read ON audit_logs FOR SELECT
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY audit_tenant_insert ON audit_logs FOR INSERT
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid
              AND user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
-- Read-only views of the caller's own tenancy rows.
GRANT SELECT ON organizations, memberships, preferences TO ceo_os_app;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_self ON memberships FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_current ON organizations FOR SELECT
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT INSERT, UPDATE ON preferences TO ceo_os_app;
--> statement-breakpoint
CREATE POLICY preferences_self ON preferences
  USING (user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), ''));
