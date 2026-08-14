import { NextResponse } from "next/server";
import { listAuditEvents } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType")?.trim() || "";
  const entityId = searchParams.get("entityId")?.trim() || "";
  if (!entityType || !entityId) return NextResponse.json({ ok:false, error:"entityType and entityId are required" }, { status:400 });
  const events = await listAuditEvents(entityType, entityId, Number(searchParams.get("take") || 50));
  return NextResponse.json({ ok:true, events }, { headers:{ "Cache-Control":"no-store" } });
}
