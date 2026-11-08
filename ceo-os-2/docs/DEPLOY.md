# Deploying CEO OS 2.0 (Railway)

Use a **new Railway project**. Don't reuse the CEO OS 1.0 or KPI dashboard services, databases or variables.

## 1. Create the project
1. Railway → **New Project** → **Deploy from GitHub repo** → `423curbappeal/CurbAppealKpiDashboard`.
2. Service settings: **Root Directory** `/ceo-os-2`, branch `claude/ceo-os-2-handoff-mp7gga` (or whichever branch you merge it into). Railway picks up `railway.json` and the `Dockerfile`.
3. On the same canvas: **+ New → Database → PostgreSQL**. Keep it on the private network only.

## 2. Variables (app service)
| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable) |
| `APP_URL` | your Railway HTTPS domain, e.g. `https://ceo-os.up.railway.app` |
| `BETTER_AUTH_URL` | same as `APP_URL` |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | output of `openssl rand -base64 32`. **Back it up somewhere safe.** If you lose it, stored calendar tokens can't be decrypted and users must reconnect |
| `CRON_SECRET` | output of `openssl rand -base64 32` (optional, for background sync) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | see step 3 (optional) |

Never paste these values into chat, screenshots or GitHub.

Migrations run automatically on every boot and are safe to re-run. The health check is `/api/health`.

## 3. Google OAuth (enables Google sign-in and Calendar)
1. Google Cloud Console → new project "CEO OS" → **APIs & Services → Library** → enable **Google Calendar API**.
2. **OAuth consent screen**: External. Add the scopes `openid`, `email` and `.../auth/calendar.events.readonly`. While the app is in *Testing*, add your Google account as a test user.
3. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URIs:
   - `https://YOUR-DOMAIN/api/integrations/google/callback` (Calendar)
   - `https://YOUR-DOMAIN/api/auth/callback/google` (Google sign-in)
4. Put the client ID and secret into Railway variables and redeploy.
5. Before **public** launch: calendar scopes are "sensitive", so Google requires app verification (privacy policy, homepage, demo video). Plan a few weeks for this.

## 4. Housecall Pro (MAX plan, optional)
Housecall Pro offers API keys only (no OAuth), so the key lives in Railway — never in an app form — and is bound to one CEO OS account.
1. Housecall Pro (web, Admin account) → App Store → API → generate a key, **read-only** if offered.
2. Railway → CEO OS app service → Variables:
   - `HOUSECALL_PRO_API_KEY` = the key
   - `HOUSECALL_PRO_ACCOUNT_EMAIL` = the email you sign in to CEO OS with
3. Redeploy, open Home: the first sync runs in the background (≈10–20 s), then refresh.
4. You → Connections → Housecall Pro shows status, **Sync now**, and **Pause**.

What it does (read-only, never writes to Housecall Pro): estimates sent in the last 60 days that await approval → follow-ups; approved estimates without a job → "Schedule approved estimate"; jobs needing scheduling → tasks; scheduled jobs (next 3 weeks) → Home schedule. Tasks close themselves when Housecall Pro shows the estimate converted/declined/expired or the job scheduled; anything you dismiss is never re-created. Syncs on Home visits when older than 30 min, on **Sync now**, and via the cron below.

## 5. Background sync (optional)
Create a Railway cron service (or any scheduler) that runs every 30 minutes:
```
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/sync
```
It syncs Google Calendar for every connected user and Housecall Pro for the bound account. Without it, sources still refresh when Home is opened with data older than 6 hours, or when you tap **Sync now**.

## 6. Backups (required before relying on it)
- Turn on Railway Postgres backups (or schedule `pg_dump` to object storage).
- **Test a restore**: restore into a scratch database, point a staging copy of the app at it, sign in and check your data. A backup that hasn't been restored isn't proven to work.

## 7. First-run checklist on iPhone
1. Open the domain in Safari → create an account.
2. Share → **Add to Home Screen** to open it full-screen like an app.
3. You → Connections → Connect Google Calendar → check today's events show on Home.
4. Capture "Call John tomorrow afternoon", log a workout, add a routine.
