import "server-only";
import { and, eq } from "drizzle-orm";
import { adminDb, schema } from "@/db";

/**
 * Idempotently creates the user's personal organization, owner membership and
 * preferences. Safe to call on every sign-in.
 */
export async function ensureTenancy(userId: string, displayName: string): Promise<{ orgId: string }> {
  const db = adminDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ orgId: schema.memberships.orgId })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.organizations.kind, "personal")))
      .limit(1);
    if (existing[0]) return { orgId: existing[0].orgId };

    const [org] = await tx
      .insert(schema.organizations)
      .values({ name: `${displayName || "My"} workspace`, kind: "personal" })
      .returning({ id: schema.organizations.id });
    await tx.insert(schema.memberships).values({ orgId: org!.id, userId, role: "owner" });
    await tx.insert(schema.preferences).values({ userId }).onConflictDoNothing();
    await tx.insert(schema.auditLogs).values({ orgId: org!.id, userId, action: "workspace.created", entityType: "organization", entityId: org!.id });
    return { orgId: org!.id };
  });
}
