import { NextResponse } from "next/server";
import { requireContext } from "@/server/context";
import { signState } from "@/server/crypto";
import { authorizationUrl, googleConfigured } from "@/server/integrations/google-calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireContext();
  if (!googleConfigured()) return NextResponse.redirect(new URL("/you/connections?error=not_configured", process.env.APP_URL ?? "http://localhost:3000"));
  const nonce = crypto.randomUUID();
  const state = signState({ u: ctx.userId, o: ctx.orgId, n: nonce, t: Date.now() });
  const res = NextResponse.redirect(authorizationUrl(state));
  res.cookies.set("ceo_oauth_nonce", nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/integrations" });
  return res;
}
