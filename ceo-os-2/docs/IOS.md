# CEO OS for iPhone — build & submit (on your Mac)

The iPhone app is a native shell (Capacitor 8) around the live CEO OS server, plus native features
the web can't do — starting with **direct Apple Health access**. Web updates go live without an App
Store release; native changes (new permissions, plugins) need a new build.

## One-time setup (≈30 min)
1. **Xcode** — install from the Mac App Store (free), open it once, accept the license.
2. **Node.js 20+** — https://nodejs.org (LTS installer).
3. **Apple Developer Program** — https://developer.apple.com/programs ($99/yr). Enroll as an
   organization to show your company name on the App Store (needs a free D-U-N-S number).
4. Get the code:
   ```bash
   git clone https://github.com/423curbappeal/CurbAppealKpiDashboard.git
   cd CurbAppealKpiDashboard/ceo-os-2
   npm ci
   npm run ios:sync
   npm run ios:open        # opens Xcode
   ```

## In Xcode
1. Select the **App** project → **App** target → **Signing & Capabilities**.
2. **Team**: pick your Apple Developer team. **Bundle Identifier**: change `com.ceoos.app` to one you
   own (e.g. `com.yourcompany.ceoos`), and set the same value as `CAP_APP_ID` when running `npm run ios:sync`.
3. Confirm **HealthKit** appears under capabilities (it's pre-configured). If not: **+ Capability → HealthKit**.
4. Plug in your iPhone (or pick it wirelessly), choose it as the run destination, press **▶ Run**.
   First time only: on the iPhone, Settings → General → VPN & Device Management → trust your developer certificate.
5. In the app: sign in → You → Body & recovery → **Connect Apple Health** → allow **Workouts**.

## TestFlight & App Store
1. Xcode → **Product → Archive** → **Distribute App → App Store Connect → Upload**.
2. In https://appstoreconnect.apple.com create the app (same Bundle ID), add yourself and beta
   testers under **TestFlight**.
3. Before submitting for review you'll need: privacy policy URL, App Privacy answers (Health &
   Fitness data: used for app functionality, not tracking), screenshots (6.9" iPhone), description,
   support URL, and a demo account for the reviewer.

## Settings you may change
- `CAP_SERVER_URL` — which server the app loads (default: production Railway URL; for local dev use
  `http://<your-mac-ip>:3000` and run `npm run dev -- -H 0.0.0.0`).
- `CAP_APP_ID` — Bundle ID.
After changing either, run `npm run ios:sync` again.

## Known requirements before public launch
- **Sign in with Apple** — required by App Review if "Continue with Google" is offered.
- **Privacy policy & terms** pages.
- **Push notifications** (morning briefing) — planned; needs an APNs key from your developer account.
