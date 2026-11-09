import { NextResponse, type NextRequest } from "next/server";
import { ingestAppleHealth } from "@/server/ingest";

export const dynamic = "force-dynamic";
const MAX_BYTES = 5_000_000;

/** Receives Apple Health workouts from the user's iPhone (Health Auto Export or an iOS Shortcut). */
export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const r = await ingestAppleHealth(request.headers.get("authorization"), payload);
  return NextResponse.json(r.body, { status: r.status });
}
