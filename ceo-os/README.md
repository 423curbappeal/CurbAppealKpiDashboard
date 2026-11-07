# CEO OS — private mobile-first preview

Separate app in the `ceo-os/` directory on branch `feature/ceo-os-mobile`. The original Curb Appeal KPI app and `main` are untouched.

## Deployment

Use a **separate Railway project or staging service**, never your existing KPI production service. Configure service:
- Source branch: `feature/ceo-os-mobile`
- Root Directory: `/ceo-os`
- Dockerfile: `Dockerfile`
- Variables: `CEO_OS_USERNAME` and a long random `CEO_OS_PASSWORD`.
- Generate an HTTPS domain for the CEO OS *app service*.

## Optional PostgreSQL cloud sync

1. On the same Railway **new CEO OS project canvas**, click **+ New → Database → PostgreSQL**.
2. Wait for the Postgres service to be running. Do NOT expose the PostgreSQL database publicly.
3. In the **CEO OS app** service → Variables → Add Reference Variable → select Postgres's `DATABASE_URL` (or explicitly set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, adjusting the actual database service name).
4. Apply/redeploy and reload your iPhone app. The notice should say **Cloud synced**.
5. With entries already saved on the iPhone, choose **Import** only if the cloud is empty and the entries should become the shared version.
6. Open the same app URL on the computer, log in, reload, and verify a new test task syncs between the devices.

The app displays a warning and keeps browser-only storage if no database is configured or if cloud syncing fails. Data on the other device loads when the page is reloaded; there is no real-time cross-device push.

## Security, reliability, and limitations

- This is a **private prototype**, NOT a hardened production application. Basic authentication over HTTPS is a temporary login system, not a full account/passkey/2FA solution.
- Browser data may be lost. Database data is persistent but **backups must be configured separately** in Railway and tested.
- Do not use for sensitive medical, identity, or financial information yet.
- The cloud API is same-origin and checks optimistic revisions to prevent silent overwrites from two devices. If a conflict happens, refresh before adding more entries; the local browser may still contain unsynced entries.
- Current Curb Appeal business KPIs are NOT integrated. The business tab links to the same-origin root and will need replacement with a safe read-only KPI integration later.
- For security, the PostgreSQL database should only be accessible on Railway's private network, not have a public networking domain.
- Never post DB or password variable values in GitHub, screenshots, or chat.
