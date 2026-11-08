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

## Read-only Curb Appeal KPI cards

CEO OS now has a backend-only, read-only connection to the *existing* KPI dashboard's saved weekly entries (not to HCP or QuickBooks directly). No change is made to the original KPI production service. To activate, add these **only to the CEO OS app service** under Railway Variables:

- `KPI_SOURCE_URL`: the live Curb Appeal KPI dashboard's bare HTTPS website URL (no `/api/` path; e.g. `https://your-kpi-domain.up.railway.app`).
- `KPI_SOURCE_USERNAME`: the live dashboard's existing `DASHBOARD_USERNAME`.
- `KPI_SOURCE_PASSWORD`: the live dashboard's existing `DASHBOARD_PASSWORD`.

The live dashboard's server must have its own username and password enabled for private access. Do not invent or change the existing dashboard credentials as part of this staging feature. Do not expose secrets in screenshots or chat.

Once deployed, open CEO OS > Business > Refresh. It shows the most recently saved week, and recent weekly revenue history. Displayed statistics are saved weeks, **not** current live monthly totals. The bridge fetches only GET /api/kpi-state, filters fields, and never writes to the KPI source. If not configured, no data is shown.

The URL must be a public HTTPS domain; private Railway service references are not supported by this initial bridge. The app service must be able to reach it from Railway.

### Validation and hardening outstanding
- Deploy CEO OS staging only and verify on phone/desktop.
- Verify live KPI Basic Auth is active and the bridge displays the expected saved weeks.
- Production-grade access management, backups, offline handling and data lineage should be completed before sensitive use.

## Daily CEO Planner — 2026-11-07

The CEO OS staging branch now includes:
- Add tasks with a due date and either top-three or standard priority
- Top-three priority limit of three open tasks per selected due date
- Recurring routines on daily, weekday, or weekend schedules
- Mark routines completed for a specific local calendar day; the checkmark resets for the next scheduled date, with completion history retained
- Month navigation and task-deadline calendar (not connected to Google Calendar)
- Daily execution score based on today's tasks plus today's scheduled routines, with home-screen completion progress

The cloud JSONB payload now supports `routines`, task `due` and `priority` fields. Legacy rows containing only tasks/workouts/posts load normally; no database migration or resetting existing records is required. The app preserves existing entries and their completion state.

**Staging verification**: Allow the separate CEO OS Railway service to redeploy this branch. On iPhone, go to Today and add one top priority and one routine; complete both and confirm score. On desktop, refresh CEO OS to confirm tasks/routines persist. Test the month calendar by creating a due date tomorrow. If a conflict warning appears because another device changed data, reload before further edits.

**Known limits**: no Google Calendar sync, push reminders, complex recurrence, automatic daily reset for unfinished tasks, or strong production authentication. CEO OS remains a prototype; its database backups and security still need review. Existing Curb Appeal KPI service and branch `main` have not been modified.

## Google Calendar read-only integration (private iCal feed)

CEO OS now supports a **read-only** feed from one Google Calendar. No Google OAuth/API account access is required for this limited view. To activate:

1. On a computer, open [Google Calendar](https://calendar.google.com), **Settings → Settings for my calendars → [your calendar] → Integrate calendar**.
2. Under **Secret address in iCal format**, click Copy. This is sensitive: the private link grants read access to events in that calendar. **Never send it in chat, screenshots, email, or a GitHub file.**
3. In Railway, open only the separate **CEO OS app** service → **Variables** → create `GOOGLE_CALENDAR_ICAL_URL` and paste the secret HTTPS address **as its value**.
4. Apply changes and wait until the CEO OS service redeploys.
5. Open CEO OS → **Today**. Look for **Google Calendar → Connected**, today's event list, and monthly event indicators. Check a date containing a real Google Calendar appointment.

The secret feed URL is stored only in Railway Variables and fetched on the app server; the browser receives an allowlisted event summary (title, start/end, all-day flag, location), never the feed URL. Events are fetched over HTTPS with a 12-second timeout, limited response size, and a server-side 10-minute cache. Google calendar feed propagation can introduce additional delay.

**Limitations:** read-only; no event creation/editing or Google Calendar OAuth access; only the calendar whose private iCal address you pasted; no automatic access to all Google calendars; dates shown in America/New_York; the app's task calendar combines deadline markers with appointment markers; events do not affect CEO Score. Calendar contents are sensitive, and this staging app uses temporary HTTP Basic authentication. Upgrade authentication before relying on it for sensitive appointments.

If a secret address is missing on an organizational calendar, the Google Workspace administrator may have disabled the feature. Revoke a leaked address in Google Calendar with the **Reset** control and replace the Railway variable.

### Safety
The original Curb Appeal KPI dashboard and its Google Calendar (if any) are unchanged; only the CEO OS staging development branch is modified.

## Optional Face ID / passkey sign-in (staging, not yet device-tested)

A passkey sign-in is included as an **opt-in feature**, preserving existing HTTP Basic username/password as an emergency recovery method.

### Activate without disabling your current login

1. Use your Mac Terminal to generate a fresh secret: `openssl rand -base64 48`. Never share the output.
2. In **Railway → the CEO OS app service → Variables**, add `CEO_OS_SESSION_SECRET` with that generated value. Do not remove `CEO_OS_USERNAME` or `CEO_OS_PASSWORD`. Ensure `DATABASE_URL` is already connected.
3. Deploy the latest `feature/ceo-os-mobile` commit. The app remains accessible through its password login even before you set up any passkey.
4. On iPhone **Safari**, use the normal CEO OS URL and existing username/password to open Home, then tap **Set up Face ID**. Follow Apple's system passkey enrollment prompt. Do not save account credentials in screenshots or chat.
5. Tap **Try Face ID sign-in** on Home (or visit `https://YOUR-CEO-OS-DOMAIN/passkey-login`) and verify a successful Face ID login.
6. For a clean test, use a private browsing session (which may require re-authentication). After at least one passkey is registered, unauthenticated visitors to the app root are redirected to the Face ID page, while **Use username and password instead** still allows HTTP Basic recovery.
7. Do not delete the password variables. Passkeys are tied to the exact HTTPS hostname: moving to another domain will require new enrollment.

Passkeys are created and held by the iPhone's passkey provider; the CEO OS database only stores a credential ID, public key and sign count. A session cookie is Secure, HttpOnly, SameSite=Strict, signed using `CEO_OS_SESSION_SECRET`, and expires after 30 days. Signing in with Face ID generally happens when the session expires or on a new browser; it does **not** force Face ID on every launch.

This is a staging implementation, not independently security-audited or confirmed working on the user's device yet. The old password login remains functional. No production KPI dashboard code is modified.
