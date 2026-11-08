import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { adminDb, schema } from "@/db";
import { syncGoogleCalendar } from "@/server/integrations/google-calendar";

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
  return NextResponse.json({ ok, failed });
}
