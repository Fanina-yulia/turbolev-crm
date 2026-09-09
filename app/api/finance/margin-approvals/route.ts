import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { approveEstimateMargin, EstimateMarginGateError, listPendingEstimateMarginApprovals } from "@/src/services/financial-estimate-margin-gate.service";
import type { FinanceActor } from "@/src/services/financial-center-v2.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function actor(access: { context: { user?: { id?: string; employeeName?: string | null; name?: string | null; email?: string | null } | null } }): FinanceActor {
  return {
    id: access.context.user?.id || null,
    name: access.context.user?.employeeName || access.context.user?.name || access.context.user?.email || "CRM / Фінанси",
  };
}

function marginError(error: unknown) {
  if (error instanceof EstimateMarginGateError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status: error.status });
  }
  console.error("[finance-margin-approvals]", error);
  return NextResponse.json({ ok: false, code: "MARGIN_APPROVAL_FAILED", error: "Не вдалося виконати погодження маржі." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const pending = await listPendingEstimateMarginApprovals(
      requestedLocationId,
      access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
    );
    return NextResponse.json({ ok: true, pending }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return marginError(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workOrderId = text(body?.workOrderId, 64);
  if (!body || !workOrderId) return NextResponse.json({ ok: false, code: "WORK_ORDER_ID_REQUIRED", error: "Вкажіть замовлення-наряд." }, { status: 400 });

  const appointment = await getPrisma().serviceAppointment.findFirst({
    where: { workOrderId },
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }, { createdAt: "desc" }],
    select: { locationId: true },
  });
  const locationId = appointment?.locationId || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, locationId);
  if (!access.ok) return access.response;

  try {
    const result = await approveEstimateMargin(workOrderId, body.note, actor(access));
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return marginError(error);
  }
}
