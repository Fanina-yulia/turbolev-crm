import { NextResponse } from "next/server";
import { getWorkflowStatus, normalizeWorkflowStatus } from "@/src/domain/workflow";
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
    const rawStatus = status?.trim().toUpperCase() || null;
    const canonicalStatus = rawStatus ? normalizeWorkflowStatus("WORK_ORDER", rawStatus) : null;
    if (canonicalStatus && !getWorkflowStatus("WORK_ORDER", canonicalStatus)) {
      return NextResponse.json({ ok: true, workOrders: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const ids = await resolveVisibleWorkOrderIds(access.context, access.grantedScope, {
      limit: Math.max(1, Math.min(500, limit)),
      status: canonicalStatus,
    });
    const workOrders = await listWorkOrders({ status: canonicalStatus, limit, ids });
    return NextResponse.json({ ok: true, workOrders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-orders failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити замовлення-наряди." }, { status: 500 });
  }
}
