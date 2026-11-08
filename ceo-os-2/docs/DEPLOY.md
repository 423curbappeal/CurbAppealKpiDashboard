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

## 4. Background calendar sync (optional)
Create a Railway cron service (or any scheduler) that runs every 30 minutes:
```
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/sync
```
Without it, calendars still refresh when Home is opened with data older than 6 hours, or when you tap **Sync now**.

## 5. Backups (required before relying on it)
- Turn on Railway Postgres backups (or schedule `pg_dump` to object storage).
- **Test a restore**: restore into a scratch database, point a staging copy of the app at it, sign in and check your data. A backup that hasn't been restored isn't proven to work.

## 6. First-run checklist on iPhone
1. Open the domain in Safari → create an account.
2. Share → **Add to Home Screen** to open it full-screen like an app.
3. You → Connections → Connect Google Calendar → check today's events show on Home.
4. Capture "Call John tomorrow afternoon", log a workout, add a routine.
