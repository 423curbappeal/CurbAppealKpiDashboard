import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(auth().handler).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth().handler).POST(request);
}
