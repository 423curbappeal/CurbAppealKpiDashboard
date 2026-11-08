# Integrations: research and plan

Principles: OAuth where it's offered, read-only first, tokens encrypted on the server, sync status visible to the user, dedupe on `(integration_id, external_id)`, one-tap disconnect that revokes access and deletes cached data. Don't ask users to paste API keys into ordinary forms.

Connector pattern (see `src/server/integrations/google-calendar.ts`): `authorizationUrl` → `completeConnection` (exchange, encrypt, upsert) → `sync` (refresh token, fetch a window, upsert, prune deletions, record status) → `disconnect` (revoke, delete). Mapping functions are pure and unit-tested.

| Provider | Feasibility | Auth | Notes / blockers | Plan |
|---|---|---|---|---|
| **Google Calendar** | ✅ Built | OAuth 2.0, `calendar.events.readonly` | Sensitive scope → Google verification needed before public launch | Live once credentials are added |
| **Outlook / Microsoft 365** | ✅ High | OAuth 2.0 (Microsoft identity platform), Graph `Calendars.Read` | Azure app registration, multi-tenant; admin consent can be required in some orgs | **Next connector**; reuses the calendar_events table |
| **Housecall Pro** | ✅ **Built (single account)** · ⚠️ product-wide pending | API key, `Authorization: Token <key>`, MAX plan, Admin-generated | No documented public OAuth/partner flow found. Webhooks MAX-only. | Built in `src/server/integrations/housecall-pro.ts` + `src/lib/housecall.ts`; verified against a live account (Nov 2026). Multi-user requires an HCP partner/OAuth program — contact HCP before selling it |
| **Jobber** | ✅ Good | OAuth 2.0 + GraphQL (versioned header required) | Developer Center account; apps go through Jobber's App Review before public use; tester accounts are time-limited | Strong candidate for the service-business segment |
| **QuickBooks Online** | ✅ Good | OAuth 2.0 (Intuit), Accounting API | Intuit app review for production keys; use Reports (P&L) for verified revenue | Unlocks automatic **revenue goal** progress |
| **Stripe** | ✅ Good | Stripe Connect OAuth (read-only) or restricted keys | | Revenue for online businesses |
| Fitness (Apple Health) | ⚠️ | HealthKit is native-only | Needs an iOS app; not possible from a web app | After a native shell exists |

### Housecall Pro: verified behavior
Checked with read-only calls on a live MAX account — field names and statuses are observed, not assumed:
- `GET /estimates?page=&page_size=100&sort_direction=desc` (newest first), `GET /estimates/{id}`
- `GET /jobs?work_status[]=unscheduled`, `GET /jobs?scheduled_start_min=&scheduled_start_max=`, `GET /jobs/{id}`
- Estimate decision lives on **options**: `status` (`submitted for signoff`, `created job from estimate`, `deleted`, …) and `approval_status` (`null`, `approved`, `pro approved`, `declined`, `pro declined`, `expired`). Estimate `work_status`: `needs scheduling`, `created job from estimate`, `pro canceled`, `user canceled`.
- Job `work_status`: `needs scheduling`, `scheduled`, `in progress`, `complete unrated`, `complete rated`, `pro canceled`, `user canceled`.
- Amounts are integer **cents**; `schedule.scheduled_start` is UTC (with `_local` variants).

### Your CEO OS 1.0 data sources
1.0 read the KPI dashboard (fed by QuickBooks via Zapier) and a private Google iCal URL. 2.0 deliberately replaces the iCal URL with OAuth (revocable, per user, not a secret URL). For business revenue, connecting QuickBooks directly is cleaner than bridging to the KPI dashboard.

### Sources (research, Nov 2026; re-check before building)
- Housecall Pro help center: [How to make an API key](https://help.housecallpro.com/en/articles/6790722-how-to-make-an-api-key) (MAX plan, admin-only)
- [Supergood: Housecall Pro API report card](https://supergood.ai/api-report-card/housecall-pro), [Rollout: HCP API essentials](https://rollout.com/integration-guides/housecall-pro/api-essentials), [ShareWillow: generate HCP API key](https://docs.sharewillow.com/en/articles/15715231-generate-housecall-pro-api-key)
- Jobber Developer Center: [App authorization](https://developer.getjobber.com/docs/building_your_app/app_authorization), [Getting started](https://developer.getjobber.com/docs/getting_started), [App lifecycle](https://developer.getjobber.com/docs/building_your_app/app_lifecycle)
