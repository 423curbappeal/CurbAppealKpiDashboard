import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native iPhone shell for CEO OS.
 * The app loads the live CEO OS server (so updates ship without an App Store release)
 * and adds native capabilities: Apple Health (HealthKit), and later push notifications.
 *
 * CAP_SERVER_URL overrides the server, e.g. a staging deploy or http://<mac-ip>:3000 for local dev.
 * appId must match the Bundle ID you register in the Apple Developer portal.
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://curbappealkpidashboard-production-2d79.up.railway.app";

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID ?? "com.ceoos.app",
  appName: "CEO OS",
  webDir: "mobile-shell",
  backgroundColor: "#07070a",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#07070a",
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
