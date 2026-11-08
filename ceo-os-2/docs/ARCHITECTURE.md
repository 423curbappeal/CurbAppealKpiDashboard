# Architecture

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript strict | Server components keep data on the server; server actions avoid writing a separate REST layer for the UI; one deployable unit |
| Styling | Tailwind 4 with design tokens in `src/app/globals.css` | One consistent system (colors, radii, motion) and no runtime CSS |
| DB | PostgreSQL + Drizzle ORM | SQL stays visible, which is important for row-level security, and migrations are plain `.sql` files |
| Auth | Better Auth (email/password now, Google ready, passkeys next) | Self-hosted, sessions stored in our DB, no per-user fees, an established library rather than hand-rolled crypto |
| Tests | Vitest (unit + integration on real Postgres), Playwright (mobile e2e) | |
| Deploy | Docker / Railway, standalone Next output, migrations on boot | |

Versions are pinned to mature releases rather than the newest majors (Next 16 and Prisma 8 RC were skipped on purpose).

## Code layout

```
src/
  lib/            Pure domain logic: no I/O, fully unit-tested
    capture.ts      natural-language → task draft
    briefing.ts     prioritization + daily briefing (transparent scoring, a reason for each item)
    progress.ts     goal progress with provenance (actual / user_entered / unavailable)
    review.ts       weekly review draft + suggestions
    dates.ts        timezone-correct calendar math (DST-safe, no dependencies)
  db/             schema.ts, client, withTenant()
  server/         Server-only: auth, context, data loaders, actions, crypto, integrations/
  components/     Design system + interactive pieces (sheet, toast/undo, capture, task row)
  app/            Routes: (app)/ Home, Execute, Growth, You, Review; (auth)/; api/
drizzle/          SQL migrations (0001_rls.sql = row-level security)
```

## Product rules encoded in code
- **Nothing is invented.** The briefing only mentions the calendar when one is connected. Revenue progress is `unavailable` until a verified source exists. Workout duration is `null` unless the user gives it. An empty account gets a setup guide, not filler.
- **Every priority has a reason**, generated from the scoring rule that produced it ("Overdue by 3 days", "Due at 2:00 PM", "You marked it high priority").
- **Confirm before saving captured text.** Capture shows what it understood. The user edits or confirms.
- **Undo instead of "are you sure?"** for everyday actions. Typed confirmation only for account deletion.
- **External actions are never faked.** "I contacted them" records the user's own statement. CEO OS doesn't send messages.

## Multi-tenancy and security

- **Model:** `organizations` (personal | business) ← `memberships` (owner/admin/member) → `user`. Each user gets a personal organization when they sign up (idempotent `ensureTenancy`). Every domain row carries `org_id` and `user_id`.
- **Enforcement in two layers:**
  1. The app filters every query by `user_id`.
  2. **Postgres row-level security.** `withTenant(ctx, fn)` opens a transaction, sets `app.org_id` / `app.user_id` (transaction-local) and runs `SET LOCAL ROLE ceo_os_app`. That role is non-superuser, has no BYPASSRLS, and has no grants on the auth tables. Policies require both IDs to match on read and write, so even an app bug can't read or write another tenant's rows. This works with Railway's single superuser login because the role switch happens per transaction.
- `tests/integration/tenant-isolation.test.ts` covers cross-tenant reads, updates, deletes and inserts, moving a row into another tenant, every domain table, no access to auth tables, missing context, and deletion cascades.
- **Secrets:** provider tokens are AES-256-GCM encrypted (`ENCRYPTION_KEY`) and never sent to the browser. OAuth `state` is HMAC-signed, expires, and is bound to the user plus a nonce cookie. Cron is protected by a bearer secret compared in constant time.
- **Sessions:** Better Auth DB sessions, HttpOnly cookies (Secure in production), rate-limited auth endpoints, 10-character minimum password.
- **Headers:** HSTS, nosniff, frame-deny, a strict referrer policy, permissions policy.
- **Audit log** for workspace creation, task lifecycle, goals, contacts, integrations and reviews.
- **Privacy:** JSON export at `/api/export` (no tokens or password hashes). Account deletion revokes Google access and cascade-deletes everything.

## Known gaps (honest list)
- No error/performance monitoring yet (Sentry or similar is next).
- Email verification and password reset need an email provider (a Resend/Postmark key).
- No CSP header yet (needs nonce wiring for Next inline scripts).
- Background sync runs only when a cron calls `/api/cron/sync`, or lazily when Home loads with stale data.
- Backups depend on the hosting provider and must be configured and **restore-tested** (see DEPLOY.md).
