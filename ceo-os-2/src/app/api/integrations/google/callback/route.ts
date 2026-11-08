import { NextResponse, type NextRequest } from "next/server";
import { requireContext } from "@/server/context";
import { verifyState } from "@/server/crypto";
import { completeConnection, syncGoogleCalendar } from "@/server/integrations/google-calendar";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const base = process.env.APP_URL ?? request.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/you/connections?${q}`, base));
    res.cookies.delete({ name: "ceo_oauth_nonce", path: "/api/integrations" });
    return res;
  };
  const ctx = await requireContext();
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("error=denied");
  const state = verifyState<{ u: string; o: string; n: string; t: number }>(params.get("state") ?? "");
  const nonce = request.cookies.get("ceo_oauth_nonce")?.value;
  if (!state || state.u !== ctx.userId || state.o !== ctx.orgId || !nonce || state.n !== nonce || Date.now() - state.t > 10 * 60_000) {
    return back("error=state");
  }
  const code = params.get("code");
  if (!code) return back("error=missing_code");
  try {
    await completeConnection(ctx, code);
    await syncGoogleCalendar(ctx);
    return back("connected=google");
  } catch {
    return back("error=exchange");
  }
}
