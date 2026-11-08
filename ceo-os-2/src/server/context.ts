import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { adminDb, schema, type TenantContext } from "@/db";
import { auth } from "./auth";
import { ensureTenancy } from "./tenancy";

export interface AppContext extends TenantContext {
  name: string;
  firstName: string;
  email: string;
  timeZone: string;
  weeklyWorkoutTarget: number;
  workoutTypes: string[];
  onboarded: boolean;
}

/** Resolves the signed-in user and their workspace. Redirects to sign-in if needed. */
export const requireContext = cache(async (): Promise<AppContext> => {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { user } = session;
  const { orgId } = await ensureTenancy(user.id, user.name);
  const [prefs] = await adminDb().select().from(schema.preferences).where(eq(schema.preferences.userId, user.id)).limit(1);
  return {
    userId: user.id,
    orgId,
    name: user.name,
    firstName: user.name.split(" ")[0] ?? "",
    email: user.email,
    timeZone: prefs?.timezone ?? "America/New_York",
    weeklyWorkoutTarget: prefs?.weeklyWorkoutTarget ?? 4,
    workoutTypes: prefs?.workoutTypes ?? ["Push", "Pull", "Legs", "Cardio"],
    onboarded: Boolean(prefs?.onboardedAt),
  };
});

export async function optionalSession() {
  return auth().api.getSession({ headers: await headers() });
}
