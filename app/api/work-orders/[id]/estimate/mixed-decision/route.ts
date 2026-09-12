import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  MixedEstimateApprovalError,
  confirmMixedEstimateApproval,
  getMixedEstimateApprovalState,
  requestMixedEstimateRevision,
} from "@/src/services/mixed-estimate-approval.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function actorName(access: { context: { user?: { employeeName?: string | null; name?: string | null; email?: string | null } | null } }) {
  return access.context.user?.employeeName || access.context.user?.name || access.context.user?.email || "CRM / Сервіс-менеджер";
}

async function locationForWorkOrder(workOrderId: string) {
  const row = await getPrisma().serviceAppointment.findFirst({
    where: { workOrderId },
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }, { createdAt: "desc" }],
    select: { locationId: true },
  });
  return row?.locationId || null;
}

function errorResponse(error: unknown) {
  if (error instanceof MixedEstimateApprovalError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[mixed-estimate-approval]", error);
  return NextResponse.json({ ok: false, code: "MIXED_ESTIMATE_OPERATION_FAILED", error: "Не вдалося обробити змішане погодження." }, { status: 500 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const locationId = await locationForWorkOrder(id);
  const access = await authorizeScopedLocation(PERMISSIONS.WORK_ORDERS_READ, request, locationId);
  if (!access.ok) return access.response;
  if (access.grantedScope === "LOCATION" && !locationId) {
    return NextResponse.json({ ok: false, code: "LOCATION_REQUIRED", error: "Для цього замовлення не визначена станція." }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, approval: await getMixedEstimateApprovalState(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const locationId = await locationForWorkOrder(id);
  const access = await authorizeScopedLocation(PERMISSIONS.WORK_ORDERS_ESTIMATE, request, locationId);
  if (!access.ok) return access.response;
  if (access.grantedScope === "LOCATION" && !locationId) {
    return NextResponse.json({ ok: false, code: "LOCATION_REQUIRED", error: "Для цього замовлення не визначена станція." }, { status: 403 });
  }
  try {
    const action = (text(body.action, 48) || "CONFIRM").toUpperCase();
    const name = actorName(access);
    const note = text(body.note, 2000);
    const result = action === "REQUEST_REVISION"
      ? await requestMixedEstimateRevision(id, name, note)
      : action === "CONFIRM"
        ? await confirmMixedEstimateApproval(id, name, note)
        : (() => { throw new MixedEstimateApprovalError("UNKNOWN_MIXED_ACTION", "Невідома операція зі змішаним погодженням."); })();
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
