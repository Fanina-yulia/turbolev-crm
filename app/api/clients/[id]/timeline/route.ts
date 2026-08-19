import { NextResponse } from "next/server";
import { getServiceTimeline } from "@/src/services/timeline.service";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const access = await getAccessContext(request);
    const open = access.enforcementMode !== "ENFORCED";
    const events = await getServiceTimeline(
      { clientId: id },
      {
        includeCommercial: open || hasPermission(access, PERMISSIONS.WORK_ORDERS_READ),
        includePayments: open || hasPermission(access, PERMISSIONS.PAYMENTS_READ),
        includeFinance: open || hasPermission(access, PERMISSIONS.FINANCE_READ),
        includeActors: open || hasPermission(access, PERMISSIONS.AUDIT_READ),
        take: 220,
      },
    );
    return NextResponse.json({ ok: true, events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/clients/[id]/timeline failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити хронологію клієнта." }, { status: 500 });
  }
}
