import { and, eq, gte, lte, notInArray } from "drizzle-orm";
import { schema, withTenant, type TenantContext } from "@/db";
import { decryptJson, encryptJson } from "../crypto";

/**
 * Google Calendar — read-only connector.
 * Scope: calendar.events.readonly on the user's primary calendar. Tokens are encrypted at rest
 * and never leave the server. Events are upserted by (integration_id, external_id).
 */

export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events.readonly"];
const SYNC_PAST_DAYS = 2;
const SYNC_FUTURE_DAYS = 21;

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
}

export function redirectUri(): string {
  return `${process.env.APP_URL}/api/integrations/google/callback`;
}

export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  return res.json();
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function completeConnection(ctx: TenantContext, code: string): Promise<void> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const tokens: TokenSet = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  const label = emailFromIdToken(t.id_token);
  await withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.userId, ctx.userId), eq(schema.integrations.provider, "google_calendar")))
      .limit(1);
    // Google omits refresh_token on re-consent sometimes; keep the previous one.
    if (!tokens.refresh_token && existing?.encryptedTokens) tokens.refresh_token = decryptJson<TokenSet>(existing.encryptedTokens).refresh_token;
    const values = {
      status: "connected" as const,
      accountLabel: label,
      scopes: t.scope ?? GOOGLE_CALENDAR_SCOPES.join(" "),
      encryptedTokens: encryptJson(tokens),
      tokenExpiresAt: new Date(tokens.expires_at),
      lastError: null,
      updatedAt: new Date(),
    };
    if (existing) await tx.update(schema.integrations).set(values).where(eq(schema.integrations.id, existing.id));
    else await tx.insert(schema.integrations).values({ orgId: ctx.orgId, userId: ctx.userId, provider: "google_calendar", ...values });
    await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "integration.connected", entityType: "integration", entityId: "google_calendar" });
  });
}

async function validAccessToken(ctx: TenantContext, integrationId: string, envelope: string): Promise<string> {
  const tokens = decryptJson<TokenSet>(envelope);
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Google access expired. Please reconnect.");
  const t = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
  const next: TokenSet = { access_token: t.access_token, refresh_token: t.refresh_token ?? tokens.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  await withTenant(ctx, (tx) =>
    tx.update(schema.integrations).set({ encryptedTokens: encryptJson(next), tokenExpiresAt: new Date(next.expires_at), updatedAt: new Date() }).where(eq(schema.integrations.id, integrationId)),
  );
  return next.access_token;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: string;
}

/** Maps a Google event to our shape. All-day dates are anchored to the user's timezone. Pure; unit tested. */
export function mapGoogleEvent(e: GoogleEvent, toInstant: (date: string) => Date) {
  if (e.status === "cancelled" || !e.start || !e.end) return null;
  const allDay = Boolean(e.start.date && !e.start.dateTime);
  const startsAt = allDay ? toInstant(e.start.date!) : new Date(e.start.dateTime!);
  const endsAt = allDay ? toInstant(e.end.date!) : new Date(e.end.dateTime!);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  return {
    externalId: e.id,
    title: (e.summary ?? "").trim().slice(0, 300) || "Busy",
    startsAt,
    endsAt,
    allDay,
    location: e.location?.slice(0, 300) ?? null,
    htmlLink: e.htmlLink && e.htmlLink.startsWith("https://www.google.com/calendar/") ? e.htmlLink : null,
  };
}

export async function syncGoogleCalendar(ctx: TenantContext & { timeZone: string }): Promise<{ synced: number } | { error: string }> {
  const { startOfLocalDay } = await import("@/lib/dates");
  const [integration] = await withTenant(ctx, (tx) =>
    tx.select().from(schema.integrations).where(and(eq(schema.integrations.userId, ctx.userId), eq(schema.integrations.provider, "google_calendar"))).limit(1),
  );
  if (!integration || integration.status === "disconnected" || !integration.encryptedTokens) return { error: "not_connected" };

  try {
    const accessToken = await validAccessToken(ctx, integration.id, integration.encryptedTokens);
    const timeMin = new Date(Date.now() - SYNC_PAST_DAYS * 86_400_000);
    const timeMax = new Date(Date.now() + SYNC_FUTURE_DAYS * 86_400_000);
    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), maxResults: "250" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) throw new Error("Google denied calendar access. Please reconnect.");
      if (!res.ok) throw new Error(`Google Calendar returned ${res.status}`);
      const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
      items.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }

    const mapped = items.map((e) => mapGoogleEvent(e, (d) => startOfLocalDay(d, ctx.timeZone))).filter((e): e is NonNullable<typeof e> => e !== null);
    await withTenant(ctx, async (tx) => {
      const now = new Date();
      for (const e of mapped) {
        await tx
          .insert(schema.calendarEvents)
          .values({ ...e, orgId: ctx.orgId, userId: ctx.userId, integrationId: integration.id, syncedAt: now })
          .onConflictDoUpdate({
            target: [schema.calendarEvents.integrationId, schema.calendarEvents.externalId],
            set: { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, location: e.location, htmlLink: e.htmlLink, syncedAt: now },
          });
      }
      // Remove events inside the sync window that no longer exist upstream.
      const keep = mapped.map((e) => e.externalId);
      const inWindow = and(eq(schema.calendarEvents.integrationId, integration.id), gte(schema.calendarEvents.startsAt, timeMin), lte(schema.calendarEvents.startsAt, timeMax));
      await tx.delete(schema.calendarEvents).where(keep.length ? and(inWindow, notInArray(schema.calendarEvents.externalId, keep)) : inWindow);
      await tx.update(schema.integrations).set({ status: "connected", lastSyncedAt: now, lastError: null, updatedAt: now }).where(eq(schema.integrations.id, integration.id));
    });
    return { synced: mapped.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar sync failed";
    await withTenant(ctx, (tx) => tx.update(schema.integrations).set({ status: "error", lastError: message.slice(0, 300), updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id)));
    return { error: message };
  }
}

export async function disconnectGoogleCalendar(ctx: TenantContext): Promise<void> {
  const [integration] = await withTenant(ctx, (tx) =>
    tx.select().from(schema.integrations).where(and(eq(schema.integrations.userId, ctx.userId), eq(schema.integrations.provider, "google_calendar"))).limit(1),
  );
  if (!integration) return;
  // Best-effort revoke at Google, then delete local tokens and cached events.
  if (integration.encryptedTokens) {
    try {
      const t = decryptJson<TokenSet>(integration.encryptedTokens);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token ?? t.access_token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
    } catch {
      /* revocation is best-effort */
    }
  }
  await withTenant(ctx, async (tx) => {
    await tx.delete(schema.integrations).where(eq(schema.integrations.id, integration.id));
    await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "integration.disconnected", entityType: "integration", entityId: "google_calendar" });
  });
}

