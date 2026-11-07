# CEO OS — mobile-first prototype

This directory contains the first isolated version of CEO OS, a dark executive-style responsive interface for phone and desktop.

## What is included
- Home command center with daily priority completion and prototype counters
- Business tab linking to the existing KPI application (when served from the same host)
- Daily priorities: add, complete, and remove
- Fitness workout notes: add and remove
- Personal brand content ideas: add and remove
- Responsive bottom navigation on mobile and sidebar on desktop
- Dark design and iPhone standalone display metadata

## Important current limitations
- This is a UI prototype, not a production-ready private application.
- Prototype entries are saved ONLY in browser localStorage. They do not sync across devices, are not backed up, and should not contain sensitive details.
- No authentication or permission boundaries have been implemented for CEO OS.
- The existing KPI app and its calculations, backend, integrations, and persistent state are unchanged.
- The Dockerfile and Railway configuration are unchanged. This new directory is NOT currently copied into the Railway image; it is not deployed.
- To test the prototype locally, open ceo-os/index.html in a desktop browser. To test on an iPhone, use a private staging deployment after authentication and configuration are added.
- The home page intentionally displays no fabricated financial or health data.

## Suggested next steps
1. Decide on domain/subdomain and authentication, then provision a separate staging service (never attach the preview to production before securing it).
2. Add a persistent database for CEO OS and back up its contents.
3. Integrate existing business KPIs using authenticated, read-only server endpoints; do not migrate/overwrite current KPI state without a data plan.
4. Add a proper web app manifest, icons, secure HTTPS staging, and an offline-safe shell after privacy controls are in place.
5. Test on iPhone Safari and desktop before any deployment to the primary Railway service.

Created on branch feature/ceo-os-mobile, separately from main.
