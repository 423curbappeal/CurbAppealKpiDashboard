import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { adminDb, schema } from "@/db";
import { syncGoogleCalendar } from "@/server/integrations/google-calendar";
import { syncHousecallPro } from "@/server/integrations/housecall-pro";

export const dynamic = "force-dynamic";

/** Background sync for all connected calendars. Call from a scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await adminDb()
    .select({ userId: schema.integrations.userId, orgId: schema.integrations.orgId, timeZone: schema.preferences.timezone })
    .from(schema.integrations)
    .leftJoin(schema.preferences, eq(schema.preferences.userId, schema.integrations.userId))
    .where(and(eq(schema.integrations.provider, "google_calendar"), ne(schema.integrations.status, "disconnected")));
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    const result = await syncGoogleCalendar({ userId: r.userId, orgId: r.orgId, timeZone: r.timeZone ?? "America/New_York" });
    if ("error" in result) failed++;
    else ok++;
  }
  // Housecall Pro: single account bound by HOUSECALL_PRO_ACCOUNT_EMAIL.
  let housecall: string = "not_configured";
  const owner = process.env.HOUSECALL_PRO_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (process.env.HOUSECALL_PRO_API_KEY && owner) {
    const [row] = await adminDb()
      .select({ userId: schema.user.id, orgId: schema.memberships.orgId, timeZone: schema.preferences.timezone })
      .from(schema.user)
      .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.user.id), eq(schema.memberships.role, "owner")))
      .innerJoin(schema.organizations, and(eq(schema.organizations.id, schema.memberships.orgId), eq(schema.organizations.kind, "personal")))
      .leftJoin(schema.preferences, eq(schema.preferences.userId, schema.user.id))
      .where(eq(schema.user.email, owner))
      .limit(1);
    if (row) {
      const r = await syncHousecallPro({ userId: row.userId, orgId: row.orgId, timeZone: row.timeZone ?? "America/New_York" });
      housecall = "error" in r ? r.error : "ok";
    } else housecall = "account_not_found";
  }
  return NextResponse.json({ ok, failed, housecall });
}
