import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { resolveVisibleWorkOrderIds } from "@/src/security/work-order-scope";
import { listWorkOrders } from "@/src/services/work-orders.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limitRaw = Number(searchParams.get("limit") || 200);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 200;
    const ids = await resolveVisibleWorkOrderIds(access.context, access.grantedScope);
    const workOrders = await listWorkOrders({ status, limit, ids });
    return NextResponse.json({ ok: true, workOrders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-orders failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити замовлення-наряди." }, { status: 500 });
  }
}
