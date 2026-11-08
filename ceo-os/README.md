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

## Fitness dashboard upgrade (2026-11-07)

The CEO OS **Fitness** tab now contains:
- Workout log with Push, Pull, Legs, Upper, Lower, Full Body, Cardio and Other session types, duration and notes
- Weekly workout completion meter (Monday–Sunday) with editable goal (1–7 workouts/week)
- Body-weight log with date and pounds, latest weight, change from first recorded check-in, chronological SVG trend and removable entries
- Strength set log (exercise, pounds, reps, date), exercise-specific trend chart and removable entries
- Fitness-related cloud fields `weigh_ins`, `lifts` and `fitness_goals` stored in the existing PostgreSQL CEO OS state with optimistic-revision sync
- Prior unstructured workouts and all other app data are still accepted and shown. No DB schema migration or Railway variables required.

The weekly training goal also syncs between devices. The app has a 250-entry cap per log type, and its weight/strength trend charts show up to the latest 30 entries. Trends represent user-entered data only; no Apple Health or fitness-service integration is included.

**Test after latest staging deployment:** On iPhone, open Fitness, log a workout, set a weekly training goal, add one weight and one strength entry. Watch the charts update and cloud status return to “Cloud synced”. Refresh on a computer to confirm all records and weekly goal match. Remove one test item and verify the deletion syncs.

**Privacy warning:** Workout, strength and body-weight records are personal health/wellness information. This remains a staging app with HTTP Basic as a recovery login, app-level passkey sessions, and no audited data protection or confirmed automated Postgres backups. Do not use it to store medical diagnoses, clinical notes or other highly sensitive details until security and recovery are improved.

## Personal Brand dashboard (November 2026)

The **Brand** tab now supports:
- Saving content ideas with platform (Instagram, Facebook, TikTok, YouTube, LinkedIn, Other), pipeline stage (Idea, Draft, Ready, Scheduled, Published), and optional planned date
- Filtering content pipeline by stage, editing any saved idea, moving it across stages, and deleting posts with confirmation
- Monthly content calendar for scheduled and published posts, with date selection
- Manual post-level views, likes, comments, shares, and follower gains for published content
- Aggregate content KPIs (in pipeline, published, logged views and attributed follower gains)

Older post ideas lacking metadata automatically behave as `Idea` / `Other`. All content remains in the same authenticated, revisioned PostgreSQL state; no database migration or new Railway variable is required. User-entered engagement is **not** fetched from social networks and cannot independently confirm real social performance. No social platforms are connected and publishing is not automated.

### Test on devices

1. Verify Railway CEO OS staging deployment is active and open the app's **Brand** tab.
2. Add a content idea and confirm **Cloud synced**.
3. Edit the idea, change it to **Scheduled**, choose a planned date and save. Select that date in the Brand calendar; the entry should appear.
4. Change it to **Published**, record example views/likes, and verify the summary counts change.
5. Refresh on desktop and confirm the same entry, dates and metrics appear. Remove test data if desired.

Original Curb Appeal KPI production code is untouched. Database backups, access hardening, and data portability are outstanding before using the staging app as critical business infrastructure.

## Session security update (November 2026)

Face ID/passkey sessions now expire after **7 days** instead of 30; previously issued 30-day session cookies will be rejected and a new Face ID sign-in may be required after deploying this update. Home shows a **Log out** button **only if a valid passkey session is active**. It calls same-origin `POST /api/logout`, clears the HttpOnly session cookie and redirects to the passkey sign-in page. `GET /api/auth-status` reports whether the currently authorized session is a passkey session or HTTP Basic login.

**Limitation:** Browsers may retain HTTP Basic authentication credentials. Clearing the passkey cookie does **not** revoke cached HTTP Basic credentials, and a previously copied signed passkey cookie remains cryptographically valid until it expires because there is not yet a server-side revocation list. Therefore do not treat Log out as a guaranteed sign-out on browsers that have used password recovery. For a fully revocable session model, replace HTTP Basic recovery with a dedicated recovery form and persist sessions and revocations in PostgreSQL. Keep the current recovery variables until a replacement has been deployed and tested.

## Server-side session revocation + manual Personal Finance tab (November 2026)

**Passkey sessions:** New Face ID sessions now use version 2 signed cookies with random session IDs, and PostgreSQL stores the session token hash and expiry in `ceo_sessions`. Each authenticated passkey request checks for an active session record. `POST /api/logout` deletes that record, then clears the browser cookie. Older version 1 cookies are no longer valid and the next visit may require a fresh Face ID sign-in. Password recovery and existing registered passkeys are preserved.

**Security limitations before treating the app as a financial vault:** HTTP Basic password-recovery remains accepted by existing authenticated endpoints and browsers may cache those credentials. Recovery/login rate limiting, audit logging, a complete security audit, database restore testing, and independently stored backups remain outstanding. Do not describe the prototype as bank-grade or financial-data-ready. Never disclose Railway secrets, database URLs, or full account numbers in chat or the dashboard.

**Finance prototype:** A sixth tab tracks manually entered personal income and expenses by month, category, and date; current assets and debts; and a calculated net-worth snapshot. It does **not** connect banking institutions or import balances. The business KPI dashboard remains read-only and separate. Financial entries are validated in `cloud_storage.py` using the existing PostgreSQL state JSON; no schema migration is required. New fields: `money_entries`, `balance_items`. Browser `localStorage` snapshots intentionally omit the financial arrays, and the finance form refuses new writes when cloud sync is disconnected. Balance re-entry with the same name and type updates the existing balance rather than doubling it. Counts are capped at 250 per category; review before using long-term.

### Manual staging verification

1. Check Railway **CEO OS app** deployment is active and PostgreSQL attached. Test Face ID sign-in. Existing passkeys remain registered, but version 1 sessions are invalidated.
2. Click **Log out**, then try the old Face ID cookie from another tab on the same device; the app should demand sign-in. Note HTTP Basic may still auto-authorize if cached.
3. On Finance, enter **sample numbers only**, record sample income and expenses in the current month, add an asset and a debt, and verify the income minus expenses and asset minus debt calculations.
4. Re-enter the same named balance with a changed amount to verify it updates rather than duplicates.
5. Check cloud sync and refresh on another device; confirm sample data persists. Delete test entries.
6. Test Railway backups by restoring a copy to a disposable database only; do not restore directly over the live database.

### Accounting limitations

Cash-flow totals only represent manually entered records. Net worth uses each currently recorded balance, not historical valuations. Enter each actual account once; create an owner-draw entry only on the personal side to avoid counting transfers as income twice. Categorizing transfers or credit card payments as expenses can double-count spending. The dashboard does not provide bank reconciliation, automated finance feeds, investment pricing, tax analysis, or financial advice.

## Plaid automatic integration — Sandbox-only developer preview

A **Plaid Sandbox test-bank connector** is now available in the Finance tab. It can launch Plaid Link with fictional banks, exchange a Sandbox public token, store encrypted test access tokens in PostgreSQL, retrieve account balances, and import transaction changes using the Plaid `/transactions/sync` cursor. The Finance tab refreshes Sandbox test data on load and has a Refresh button. **No real bank-account access is enabled, and no banking data is imported from ChatGPT's separate Finances connection.** Sandbox totals are displayed separately from manually entered Finance information.

### Required Railway variables on CEO OS service (never share values)

- `PLAID_ENV` = `sandbox` (anything else deliberately disables the integration).
- `PLAID_CLIENT_ID` = the Plaid client ID from Plaid Dashboard.
- `PLAID_SANDBOX_SECRET` = the **Sandbox secret**, not Production secret, from Plaid Dashboard.
- `PLAID_TOKEN_ENCRYPTION_KEY` = a new, unique secret generated on Mac Terminal with `openssl rand -hex 32`. Keep secure and backed up in a private secrets manager: changing it makes stored Sandbox access tokens unreadable.
- Existing `DATABASE_URL` and `CEO_OS_SESSION_SECRET` must remain configured; never replace or delete them.

Plaid Sandbox uses fictional bank credentials (typically `user_good` and `pass_good`, or current options shown by Plaid Link). Visit the Finance tab, tap **Connect test bank**, authorize a fictional account, and verify sample balances/transactions appear. The test integration requires a working **Face ID passkey session**, not only the HTTP Basic fallback.

### Important safety limits

- This implementation **cannot** contact Plaid Production: its HTTPS API host is hardcoded to `https://sandbox.plaid.com` and startup rejects anything but `PLAID_ENV=sandbox`.
- Plaid Sandbox data is separate from all manually logged income, expenses, debt and net-worth entries.
- Token encryption uses Fernet with key derivation from a separately provisioned `PLAID_TOKEN_ENCRYPTION_KEY`. Tokens never leave backend APIs.
- On each Finance load it fetches sample balances and synchronizes sample transactions; data depends on Plaid's upstream refresh and may not be real-time. A true scheduled sync/webhook architecture and bank-feed reconciliation are not yet implemented.
- A **real bank connection must not be turned on** before full replacement of cached HTTP Basic recovery, multi-factor session and rate-limit testing, encrypted backups and restore drill, disclosure/consent UX, token rotation and removal workflows, account-category reconciliation, privacy and security audit.
- This is developer-preview code; compilation, live Sandbox linking and Railway deployment require testing before using the connector. Never enter actual institution usernames/passwords in CEO OS or share Plaid secrets in chat.
