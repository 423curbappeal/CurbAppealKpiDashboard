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

## Opt-in replacement for browser-cached HTTP Basic recovery (November 2026)

A new password **recovery form** is available without altering the existing Railway username/password. When used, it checks credentials with a constant-time digest comparison and PostgreSQL-backed per-peer/account attempt limit (6 failures / 15 minutes), then issues a revocable **7-day password session**. Password sessions work with the CEO OS planner, business, fitness, brand and manually entered finance, but **Plaid Sandbox requires a genuine Face ID/passkey session**. Logging out deletes either session type in PostgreSQL.

### Safe upgrade and rollback

1. Let Railway deploy the newest `feature/ceo-os-mobile` staging code. **Do not change any existing secrets.**
2. Before activating, open `https://<CEO-OS-HOST>/recovery-preview` in Safari Private Browsing, enter the **existing** CEO OS credentials, verify the dashboard opens, then use Home → Log out. Do not send credentials or screenshots of them in chat.
3. Separately verify Face ID login. Your registered passkey is not deleted by this change.
4. Only after **both** recovery and Face ID sign-in work, add the optional Railway service variable `CEO_OS_RECOVERY_MODE=form`. This disables acceptance of Basic credentials on normal dashboard routes and changes the `/password-login` link to the form.
5. Retest Face ID, `/password-login`, logout, and the browser's private mode. A password recovery session will not authorize Plaid Sandbox; log in with Face ID for the test-bank connector.
6. **Rollback:** delete the optional `CEO_OS_RECOVERY_MODE` variable and redeploy; old Basic Auth works again. Keep `CEO_OS_USERNAME`, `CEO_OS_PASSWORD`, `CEO_OS_SESSION_SECRET` and `DATABASE_URL` untouched.

The new form is tested by code checks only until the operator verifies it on a device. HTTP Basic is still available **until** the optional Railway flag is enabled; do not claim that the old authentication is retired before then. Rate limits are simple protection, not a substitute for a security audit. Database backup restoration and deeper financial-data protection remain incomplete, so live bank production is still disabled.

## Automatic transaction classification (Plaid Sandbox, 2026-11-07)

The Finance tab now shows a **separate monthly Sandbox cash-flow breakdown**: classified income, classified spending, net cash flow, count of ambiguous items needing review, transfer/debt-payment volume excluded, pending count, and category-level spending.

Conservative classification uses Plaid Personal Finance Category and transaction sign:
- Plaid positive amount means a debit, negative means a credit.
- Posted, clearly categorized expenses count as spending; clearly categorized income credits count as income.
- Transfers, card/debt payments and recognized internal movement are not included in spending or income.
- Pending records are excluded to avoid later double-counting when posted.
- Ambiguous deposits, refunds, unknown categories and inconsistent transaction directions remain marked **Needs review**, excluded from totals until there is enough information.
- Monthly summaries cover all locally retained synchronized transactions, not just the 350 shown in the UI. Counts are not authoritative if synchronization history is incomplete or some transactions have aged out of retention.
- The user's **manual personal Finance entries remain separate** from fictional Sandbox numbers, so sample balances never flow into real financial totals.

The categorizer lives in `plaid_categorize.py`, with a credential-free test suite `test_plaid_categorize.py`. Run from the `ceo-os` directory with `python -m unittest test_plaid_categorize.py` to verify the included scenarios. **This deployment has code-level inspection but has not yet been tested against the user's live Railway Sandbox output.**

The test-bank data refreshes when the app is opened and when **Refresh sample data** is tapped. It does **not** have background scheduled syncs, webhook processing, user-correction persistence or live bank connections. Plaid's metadata and merchant names can be wrong; never assume automated categories are definitive. Real bank credentials and production Plaid APIs remain disabled.

## Financial insights (Plaid Sandbox, 2026-11-07)

Finance → Plaid Sandbox displays three new read-only, **fictional test-data** insights on each refresh:

- **Cash-flow trend**: up to six months with recorded transactions, showing posted, classified income and expenses. Missing months are not treated as months with zero activity; partial months and incomplete bank history must not be interpreted as a full statement.
- **Biggest spending categories**: top five by amount, with percent of classified spending, for the selected statement month.
- **Possible recurring expenses**: posted expenses with matching account + normalized merchant name and broadly stable amounts (within 20% of median), seen across distinct dates with monthly-looking intervals of 25–40 days, or weekly-looking intervals of 6–8 days (at least three observations for weekly). These are unconfirmed historical patterns, **not** established subscriptions, contract obligations, or predictions of the next due date.

Classification continues excluding pending entries, transfers, debt payments and ambiguous credits from monthly income/spending. Trend data is derived from the saved Sandbox transactions already retrieved by the backend, not from real accounts. If a Plaid refresh fails, previously saved transactions may still be shown with a warning. Test cases added in `test_plaid_categorize.py`. No new Railway variables, external apps, automated background jobs, or production banking access are introduced.

**Verification:** Open Finance → Plaid Sandbox and tap Refresh sample data. Inspect the cash-flow trend, top categories and recurring candidates. Code inspection is not a substitute for testing the live deployed app or executing the Python test suite; these remain to be validated before calling the feature fully tested.

## Plaid Sandbox transaction review and merchant rules (November 2026)

The Finance tab now shows a **Review uncategorized test transactions** section and a **Correct** button on recent Sandbox transactions. After selecting a category, tap **Save category**. Optionally check **Remember this merchant** to apply the same category to future synced transactions with the same normalized merchant name **on the same Plaid account**.

Corrections are stored in the new PostgreSQL `ceo_plaid_sandbox_rules` table, separate from original imported Plaid transactions. Each correction is keyed by transaction ID; optional merchant rules are keyed by account ID and normalized merchant. Explicit transaction rules take precedence over merchant rules, and both take precedence over Plaid's default category. The overview recomputes cash-flow totals, top spending, recurring candidates, and monthly trends using corrections. Disconnection deletes Sandbox rules along with Sandbox test accounts.

The `POST /api/plaid/correct` endpoint requires an authenticated passkey session, a same-origin JSON request, and an existing saved test transaction. The backend rejects assigning an expense label to a credit, assigning Income to a debit, or applying corrections to pending/zero-value transactions. The dropdown supports Income, Transfer, Needs review, and the existing expense categories. Merchant rules are an **opt-in** action, never created automatically.

**Privacy and accuracy notes:** Plaid Sandbox remains fictional data only. Merchant names may be ambiguous; opt into merchant-wide rules only when transactions genuinely belong in the same category. Transaction corrections persist in the staging PostgreSQL database but have not been tested against the deployed Railway UI. The Python test file includes override and account-scoping cases; actual execution of those tests and production-grade security remain outstanding. No new environment variables are needed.

## Production Plaid preparation — locked by default (2026-11-07)

**This update does not connect real accounts.** It introduces a second `plaid_live.py` connector and separate `ceo_plaid_live` / `ceo_plaid_live_rules` tables. Access tokens use a dedicated Production encryption key; Sandbox tokens, test rows, and rules are never reused. The Finance tab will show **Personal bank connection — Locked** until all live requirements are satisfied. The existing Sandbox connection is unchanged.

Live access is intentionally fail-closed. The code checks for all of the following **service-side** configuration values before allowing a production request:

- Existing `PLAID_CLIENT_ID` and `DATABASE_URL`.
- Production-specific `PLAID_PRODUCTION_SECRET` issued by Plaid (never commit to GitHub).
- A distinct random `PLAID_PRODUCTION_TOKEN_ENCRYPTION_KEY` (40+ characters; preserve it securely for restoring encrypted token data).
- `CEO_OS_RECOVERY_MODE=form` after safe testing of the password recovery path.
- Explicit `PLAID_LIVE_APPROVED=yes` only following Plaid production entitlement and operator security, privacy, OAuth, and database recovery review.
- When needed for browser OAuth redirect, `PLAID_PRODUCTION_REDIRECT_URI` must be an approved HTTPS URL configured in the Plaid Dashboard. The app currently does **not** provide an OAuth redirect reinitialization route or webhook receiver; test supported institution flows and implement those before launching broadly.

**Do not set these variables merely to unlock the button.** First obtain Plaid Production access, verify database backup and recovery in a separate environment, review financial-data privacy/security obligations, remove cached HTTP Basic authentication via the previously tested form migration, and test consent, token revocation, relinking, sync error recovery, and Safari OAuth redirects. The existing password backup remains in place until the user elects the migration.

The live read-only data flow uses `/api/plaid-live/status`, `/api/plaid-live/link-token`, `/api/plaid-live/exchange`, `/api/plaid-live/overview`, `/api/plaid-live/correct` and `/api/plaid-live/disconnect`. All data or mutation routes require a valid, server-revocable passkey session; writes require same-origin JSON. Linking always requires a person to explicitly authorize their institution via Plaid Link. Data is not imported into manual finance totals; there are separate read-only live balances and monthly cash-flow summaries. Production code is untested against real institutions and should not be represented as production-ready.

### Incremental sync hardening

Both environments now restart `/transactions/sync` pagination from the original saved cursor if Plaid returns `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, persist complete batches only, and stop instead of advancing the cursor when the current 2,500-row retention limit would silently drop entries. When sync fails, previously saved transactions are retained with a visible warning. These behavior changes follow [Plaid Transactions Sync documentation](https://plaid.com/docs/api/products/transactions/) and [transaction error guidance](https://plaid.com/docs/errors/transactions/).

**Remaining launch blockers:** authoritative production entitlement/configuration, tested backups/restore, formal privacy/security review, full OAuth redirect support for embedded browsers, webhook/scheduled syncing, retention policy, reconciliation for credit cards and transfers across multiple institutions, and production end-to-end testing. Do not imply real balances are connected or that ongoing background sync is implemented.

## Backup and restore verification (2026-11-07)

A disposable **synthetic database** backup/restore integration test is now included in `ceo-os/test_backup_restore.sh` and the branch's `.github/workflows/ceo-os-checks.yml`. The GitHub workflow starts its **own local PostgreSQL 16 service**, loads fictional records covering eight CEO OS tables, runs `pg_dump -Fc`, restores via `pg_restore` into a separate local database, compares table contents, and deletes the local test data. It has no access to Railway credentials or the production database.

**Safety guardrails:** the script rejects remote database hosts and requires explicit `CEO_OS_TEST_MODE=synthetic-fixtures-only`. Test database names are hard-coded and it refuses to start if they already exist. The cleanup handler only deletes test databases the current run created. No database dumps are committed to GitHub or uploaded as workflow artifacts. Never use this script for backups of real financial data.

**Still required before live banking:** configure private, encrypted, off-service backups for Railway PostgreSQL with an established retention policy; confirm an actual restore using an isolated copy with access-controlled recovery personnel; preserve the dedicated token-encryption keys using a secure secrets manager; and document recovery time/recovery point targets. These provider-level actions are *not* completed by the synthetic integration test. Do not enable Plaid Production until they are done. GitHub and Railway commit/status checks do not prove user flows, real-bank authorization, or actual production restore.

## Six operating features — personal CEO OS (2026-11-08)

Added `command_modules.js` to the **feature/ceo-os-mobile** branch, integrated through the existing authenticated staging server and Railway image. Existing Home, Today, Business KPI, Fitness, Brand, Finance, Face ID, and Plaid Sandbox functionality remains in place. The bottom mobile navigation scrolls to accommodate two new tabs: **Goals** and **Sales**.

- **CEO Daily Planner** (Today): add, view and remove date-specific Work/Personal/Fitness blocks with start/end times and visible overlap warnings. Google Calendar is still read-only; a time block is not sent to Google Calendar.
- **Goals & Accountability** (new Goals tab): measurable Business, Personal, and Fitness goals with units USD, Count or Percent, optional due date, progress bar and manually editable current value. Defaults to no invented progress. A business USD revenue goal labeled with 'revenue' appears in the Business dashboard.
- **Business Command Center** (Business): manual sales pipeline counts, open quoted value, follow-ups due, and estimated close rate for tracked leads. The original saved-week KPI feed remains read-only; these figures are not combined with or claimed to be Housecall Pro data.
- **Financial Freedom Tracker** (Finance): manual recurring monthly bills, due days, monthly paid checkmarks, spending category budgets versus manual monthly expenses. All records remain separate from Plaid Sandbox and inactive live banking. No automatic bill payment is performed.
- **Sales & Follow-Up Center** (new Sales tab): add service opportunities with stages New / Contacted / Quoted / Won / Lost, estimated value, follow-up date and a short note. Advance stage, edit due date/stage, mark Won/Lost through edit, filter and remove. No customer communication occurs automatically.
- **Discipline & Fitness** (Fitness): 7-day workout consistency, consecutive workout-day streak (using prior day if today has not been logged), routine completion counts and existing weekly training target. Uses existing workouts and routines only, with no wearable integration.

New cloud-state keys are `time_blocks`, `goals`, `leads`, `bills` and `budgets`; validation is implemented in `cloud_storage.py`. Old state payloads remain compatible and load with empty collections for new keys. The web app's localStorage omits financial and sales collections, including financial goals; a working cloud connection is needed to persist those securely across devices. Records are held in the existing staging PostgreSQL database; until security review and backup setup are complete, avoid entering detailed sensitive customer or financial information.

**Verification:** GitHub CI runs Python validation tests in `test_command_features.py`, the previous financial category tests, and the synthetic DB restore test. Review the branch CI result and Railway deployment status, then test adding one item in each feature and refreshing CEO OS. Static JavaScript syntax and DOM identifier checks passed during development; actual browser interactions have not been tested on the user's iPhone yet.

**Known limitations:** time-block collisions are flagged but not prevented; sales stages and metrics are manually maintained; the budgeting screen uses current calendar month only; bills and budgets do not initiate payments; goal progress is manually updated; no business revenue is inferred from unrelated weekly KPI values.

## Morning Briefing and Weekly CEO Review (2026-11-08)

New authenticated `morning_review.js` adds two Home sections without replacing existing Home cards:
- **Morning briefing**: due or undated open tasks (top-priority first), overdue/due-today sales follow-ups, unpaid monthly bills falling due in the next seven calendar days, current-week workout count vs existing weekly goal, plus today's CEO time blocks and read-only Google Calendar appointments. The bill calculation clamps due day 29–31 to the last day of shorter months. Up to four priority/lead/bill items and six scheduled items display; totals count all. Links navigate to existing Today/Sales/Finance tabs. Does not send notifications, charge bills, or message customers.
- **Weekly review**: current Monday–Sunday reporting week, workout sessions based on timestamp, completed tasks **with a due date within that week** (the task completion timestamp is not known), current total Won leads **all-time tracked** (not presented as wins this week), and the latest available historical saved KPI week with its date. Captures wins, improvements, next-week primary focus, and explicit manually entered next-week revenue, outreach-count and workout targets. Saves one review per Monday week and updates it rather than duplicating.
- **Data handling**: `weekly_reviews` is a new validated entry in the existing PostgreSQL cloud state, with 500-character note limits, nonnegative target limits, strict Monday start date, and at most 250 records. No private review details are cached in localStorage. Saving requires the cloud connection, and the UI shows that the save is queued rather than falsely asserting DB confirmation. Financial account data is not accessed.
- **Sync and integration**: the morning panels recompute when the dashboard renders after saved-state changes and when KPI or Google Calendar data arrives. Both existing scripts and the new file are packaged in the Railway Docker build; the static file is accessible only through the authenticated app route.
- **Verification**: new review validator unit tests and JavaScript/DOM/static-file CI checks are committed. Check GitHub Actions/Railway after deployment, then refresh Home on the iPhone, inspect daily items and save a Sunday review. Live-bank integration remains locked.
