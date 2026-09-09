import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { buildPartQueryPlan } from "@/src/services/part-catalog-intelligence.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PARTS_READ, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const p = request.nextUrl.searchParams;
  return NextResponse.json({ ok: true, queryPlan: buildPartQueryPlan({ query: p.get("q"), partName: p.get("partName"), canonicalCode: p.get("canonicalCode"), provider: p.get("provider") === "BM_PARTS" || p.get("provider") === "UNITRADE" ? p.get("provider") : null, attributes: { axis: p.get("axis"), side: p.get("side"), position: p.get("position"), subPosition: p.get("subPosition") } }) }, { headers: { "Cache-Control": "no-store" } });
}
