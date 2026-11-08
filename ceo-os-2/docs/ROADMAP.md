# Roadmap

Ordered by how much manual work each step removes, against what it costs.

## Next (to make it your daily driver)
1. **Deploy + Google Calendar live** (credentials only, code is done).
2. **Passkeys / Face ID sign-in** (Better Auth passkey plugin) and password reset over email.
3. **Microsoft Outlook calendar** connector.
4. **Housecall Pro, single-tenant**: read-only key in a server env var → open estimates and unscheduled jobs become follow-ups automatically (deduped by HCP ID). Removes the double entry you named as the biggest pain.
5. **QuickBooks** → verified revenue → the $1M goal tracks itself.

## AI layer (on top of the deterministic core, never replacing it)
- Briefing narration: an LLM rewrites the computed facts into 2–3 sentences, given only the structured briefing as context. The output is checked so it can't introduce numbers that aren't in the input.
- Capture fallback: when the rule parser has low confidence, the LLM returns the same `CaptureResult` schema through tool/structured output, still behind the confirm step.
- Meeting prep: summarize the event plus related tasks and contact history.
- All AI actions are proposals that the user confirms. Nothing is executed silently. Server-side only, with per-user rate limits and cost tracking.

## Product hardening (before outside users)
- Error + performance monitoring, CSP, email verification, staging environment, restore-tested backups, a GitHub Actions CI (typecheck, unit, integration and e2e on a Postgres service).
- Business organizations: invite members, shared business tasks, assignment (the RLS policies already key on `org_id`; per-record visibility rules get added then).
- Push notifications (web push on installed PWA), offline queue for quick actions.
- Billing (Stripe) and a subscription screen in You.

## Repository
CEO OS 2.0 lives in `ceo-os-2/` because this session could only access the existing repository. It's fully self-contained. To move it to its own repo, preserving history:
```bash
git subtree split --prefix=ceo-os-2 -b ceo-os-2-only
# create the new empty repo, then:
git push git@github.com:423curbappeal/ceo-os.git ceo-os-2-only:main
```
