import { NextResponse } from "next/server";
import { requireContext } from "@/server/context";
import { exportAll } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireContext();
  const data = await exportAll(ctx);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ceo-os-export-${data.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
