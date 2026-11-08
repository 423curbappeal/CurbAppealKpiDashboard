import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { adminDb, schema } from "@/db";
import { ensureTenancy } from "./tenancy";

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function createAuth() {
  return betterAuth({
    appName: "CEO OS",
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(adminDb(), {
      provider: "pg",
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
    },
    socialProviders: googleConfigured
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" } }
      : undefined,
    account: { encryptOAuthTokens: true },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
    databaseHooks: {
      user: {
        create: {
          after: async (u) => {
            await ensureTenancy(u.id, u.name);
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __ceoAuth?: Auth };

/** Lazily constructed so builds don't require runtime secrets. */
export function auth(): Auth {
  globalForAuth.__ceoAuth ??= createAuth();
  return globalForAuth.__ceoAuth;
}

export const authProviders = { google: googleConfigured };
