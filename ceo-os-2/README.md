# CEO OS 2.0

**Run your day. Grow your business. Build your life.**

An AI-assisted personal operating system for ambitious people. You connect the tools you already use, and CEO OS figures out what matters today. The goal is a two-minute morning check-in, not another app to maintain.

> CEO OS 2.0 is a separate application from CEO OS 1.0. It has its own code (`ceo-os-2/`), its own database, its own environment variables and its own deployment. It shares nothing with 1.0 (`ceo-os/` on `feature/ceo-os-mobile`) or with the KPI dashboard on `main`, and changes neither.

## What's in this first MVP

| Capability | Status |
|---|---|
| **Home: daily briefing.** Greeting, factual summary, top 3 priorities each with a stated reason, today's schedule, alerts, quick log | ✅ Working, tested end to end |
| **Execute: unified action list.** Overdue / Today / Upcoming / Anytime / Snoozed / Done. One-tap complete with undo, snooze, reschedule, priority, "I contacted them" | ✅ |
| **Natural-language capture.** "Remind me to call John tomorrow afternoon" → confirm → saved. Voice dictation where the browser supports it | ✅ Rule-based parser, 11 test scenarios |
| **Quick actions.** One-tap workout logging (protected against accidental double logs), routine check-offs, contact logging | ✅ Duration is never invented |
| **Growth: automatic progress.** Workouts/week, routine consistency and tasks/week come from recorded activity. Every number is labeled **Actual**, **You entered** or **Not tracked** | ✅ Revenue shows "Not tracked" until a verified source is connected |
| **Weekly review.** Drafted automatically: wins, habits, meetings, goals, unfinished work (move / leave / drop), ideas for next week, reflection, approve | ✅ Only the changes you approve are applied |
| **Housecall Pro (MAX).** Open estimates → follow-ups with real amounts; approved-not-scheduled and unscheduled jobs → tasks; scheduled jobs on Home; tasks auto-close from Housecall Pro status; briefing pipeline line | ✅ Verified against a live account (read-only) |
| **Body & recovery.** Front/back muscle map colored Ready / Recovering / Fatigued from logged workouts; daily "what to train" suggestion with its reason; suggested workout highlighted in the quick log | ✅ Estimate, not medical advice |
| **Apple Watch / Apple Health.** Workouts pushed from the iPhone (Health Auto Export REST automation or a Shortcut) to a per-user token endpoint; real durations; runs/rides/HIIT auto-classified; one-tap "what did you train?" for strength | ✅ Endpoint and flow tested; awaiting first real export to confirm field names |
| **Google Calendar.** OAuth, read-only, encrypted tokens, deduplicated sync, disconnect + revoke | ✅ Code complete. **Needs Google OAuth credentials before it can be used** |
| Accounts, personal workspace, data export, account deletion, audit log | ✅ |
| Tenant isolation enforced by Postgres row-level security | ✅ Integration-tested |
| Installable on iPhone home screen (PWA, safe areas, dark theme) | ✅ |

### Deliberately not built yet
- **An LLM.** The briefing, prioritization and capture are deterministic and explainable. An LLM layer is planned on top (see [docs/ROADMAP.md](docs/ROADMAP.md)), but the core never depends on one, so it can't make anything up.
- Outlook, QuickBooks, Jobber and Stripe. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for feasibility research.
- Teams/assignment, billing, push notifications, passkeys.

## Run locally

```bash
cd ceo-os-2
npm ci                      # .npmrc sets legacy-peer-deps (Better Auth lists unrelated optional peers)
cp .env.example .env        # fill DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY
npm run db:migrate
npm run dev                 # http://localhost:3000
```

## Tests

```bash
npm test                    # unit: capture parser, briefing engine, progress, review, crypto, event mapping
npm run test:integration    # real Postgres: creates ceo_os_test, runs migrations, proves tenant isolation
npm run test:e2e            # Playwright on an iPhone 14 viewport against a running build
npm run lint                # TypeScript strict typecheck
```

What was actually verified: 37 unit tests, 16 integration tests (incl. Housecall Pro sync against a fake API), a live read-only Housecall Pro sync, on PostgreSQL 16, 2 end-to-end browser tests (production build and standalone server layout), a clean `next build` and a clean strict typecheck. **Not verified:** the Docker image build (no Docker daemon in the build environment), a live Google OAuth round trip (no credentials), and real-device iPhone testing.

## Docs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, data model, security model, key decisions
- [docs/DEPLOY.md](docs/DEPLOY.md): Railway deployment, Google OAuth setup, backups
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): provider research and plan
- [docs/ROADMAP.md](docs/ROADMAP.md): what comes next and why
