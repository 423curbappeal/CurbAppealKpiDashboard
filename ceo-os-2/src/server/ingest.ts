import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminDb, schema, withTenant, type TenantContext } from "@/db";
import { parseWorkoutPayload } from "@/lib/apple-health";
import { localDate } from "@/lib/dates";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a new personal token (replacing any existing ones). The plaintext is returned once and never stored. */
export async function issueIngestToken(ctx: TenantContext): Promise<string> {
  const token = `ceo_${randomBytes(32).toString("base64url")}`;
  await withTenant(ctx, async (tx) => {
    await tx.delete(schema.ingestTokens).where(eq(schema.ingestTokens.userId, ctx.userId));
    await tx.insert(schema.ingestTokens).values({ orgId: ctx.orgId, userId: ctx.userId, tokenHash: hashToken(token), lastFour: token.slice(-4) });
    await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "ingest_token.issued", entityType: "ingest_token", entityId: null });
  });
  return token;
}

export async function revokeIngestTokens(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx.delete(schema.ingestTokens).where(eq(schema.ingestTokens.userId, ctx.userId));
    await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "ingest_token.revoked", entityType: "ingest_token", entityId: null });
  });
}

const WINDOW_DAYS = 60;

export interface IngestOutcome {
  status: number;
  body: { imported?: number; duplicates?: number; skipped?: number; error?: string };
}

/** Authenticates a bearer token and imports workouts for its owner only. */
export async function ingestAppleHealth(authorization: string | null, payload: unknown, now = new Date()): Promise<IngestOutcome> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !token.startsWith("ceo_") || token.length < 40) return { status: 401, body: { error: "unauthorized" } };

  // Cross-tenant lookup by hash is the one privileged step; everything after runs under RLS.
  const [row] = await adminDb()
    .select({ id: schema.ingestTokens.id, userId: schema.ingestTokens.userId, orgId: schema.ingestTokens.orgId, timeZone: schema.preferences.timezone })
    .from(schema.ingestTokens)
    .leftJoin(schema.preferences, eq(schema.preferences.userId, schema.ingestTokens.userId))
    .where(eq(schema.ingestTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return { status: 401, body: { error: "unauthorized" } };

  const parsed = parseWorkoutPayload(payload);
  const ctx = { userId: row.userId, orgId: row.orgId };
  const r = await importWorkouts(ctx, row.timeZone ?? "America/New_York", parsed, now, row.id);
  return { status: 200, body: r };
}

/** Imports parsed workouts for one user under RLS. Shared by the token endpoint and the in-app (native) sync. */
export async function importWorkouts(
  ctx: TenantContext,
  tz: string,
  parsed: ReturnType<typeof parseWorkoutPayload>,
  now = new Date(),
  tokenId?: string,
): Promise<{ imported: number; duplicates: number; skipped: number }> {
  const cutoff = now.getTime() - WINDOW_DAYS * 86_400_000;
  const fresh = parsed.workouts.filter((w) => w.start.getTime() >= cutoff && w.start <= now);
  const imported = await withTenant(ctx, async (tx) => {
    let n = 0;
    for (const w of fresh) {
      const r = await tx
        .insert(schema.activities)
        .values({
          orgId: ctx.orgId,
          userId: ctx.userId,
          type: "workout",
          label: w.label,
          occurredAt: w.start,
          localDate: localDate(w.start, tz),
          durationMinutes: w.durationMinutes,
          energyKcal: w.energyKcal,
          source: "apple_health",
          externalId: w.externalId,
        })
        .onConflictDoNothing()
        .returning({ id: schema.activities.id });
      n += r.length;
    }
    if (tokenId) {
      await tx
        .update(schema.ingestTokens)
        .set({
          lastUsedAt: now,
          lastPayloadSummary: { received: parsed.workouts.length + parsed.skipped, imported: n, skipped: parsed.skipped, fields: parsed.fieldsSeen },
        })
        .where(eq(schema.ingestTokens.id, tokenId));
    }
    return n;
  });
  return { imported, duplicates: fresh.length - imported, skipped: parsed.skipped + (parsed.workouts.length - fresh.length) };
}
