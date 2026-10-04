import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { getCustomerLifetimeMetrics } from "@/src/services/customer-ltv.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ clientId: string }> };

function permissionScope(context: Awaited<ReturnType<typeof getAccessContext>>, permission: string) {
  return context.permissions[permission as keyof typeof context.permissions] as AccessScopeCode | undefined;
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.CLIENTS_READ)) {
    return NextResponse.json({ ok: false, error: "Немає доступу до клієнтів." }, { status: 403 });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.ANALYTICS_READ)) {
    return NextResponse.json({ ok: true, permitted: false, ltv: null }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ)) {
    return NextResponse.json({ ok: true, permitted: false, ltv: null }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { clientId: rawClientId } = await routeContext.params;
  const clientId = rawClientId.trim().slice(0, 120);
  if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_ID_REQUIRED" }, { status: 400 });

  const prisma = getPrisma();
  const exists = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!exists) return NextResponse.json({ ok: false, error: "Клієнта не знайдено." }, { status: 404 });

  const analyticsScope = context.enforcementMode === "ENFORCED" ? permissionScope(context, PERMISSIONS.ANALYTICS_READ) : "ALL";
  const financialScope = context.enforcementMode === "ENFORCED" ? permissionScope(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ) : "ALL";
  const clientScope = context.enforcementMode === "ENFORCED" ? permissionScope(context, PERMISSIONS.CLIENTS_READ) : "ALL";
  const unrestricted = context.enforcementMode !== "ENFORCED" || (analyticsScope === "ALL" && financialScope === "ALL" && clientScope === "ALL");

  if (!unrestricted) {
    if (!context.locationIds.length) return NextResponse.json({ ok: false, error: "Немає доступу до цього клієнта." }, { status: 403 });
    const accessible = await prisma.serviceAppointment.findFirst({
      where: {
        clientId,
        locationId: { in: context.locationIds },
        workOrderId: { not: null },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { id: true },
    });
    if (!accessible) {
      return NextResponse.json({ ok: false, error: "Немає доступу до цього клієнта у вашому station-scope." }, { status: 403 });
    }
  }

  try {
    const [ltv] = await getCustomerLifetimeMetrics({
      clientIds: [clientId],
      locationIds: unrestricted ? null : context.locationIds,
    });
    return NextResponse.json({
      ok: true,
      permitted: true,
      ltv: ltv ?? null,
      semantics: {
        lifetimeRevenue: "ACTUAL grossRevenue уже нетто від discount/refund.",
        lifetimeGrossProfit: "Сума ACTUAL grossProfit закритих Work Order.",
        lifetimeContribution: "Lifetime gross profit мінус factual WarrantyClaimCostFact.",
        coverage: "Primary LTV показується тільки при 100% finance та warranty-cost coverage і єдиній валюті.",
        acquisitionCost: "CAC не рахується, доки немає canonical client-level acquisition-cost attribution.",
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/analytics/client-ltv/[clientId] failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося побудувати LTV клієнта." }, { status: 500 });
  }
}
