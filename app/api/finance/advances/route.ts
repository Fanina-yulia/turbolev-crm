import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  FinanceSettlementError,
  applyCustomerAdvanceSettlement,
  listFinanceAdvances,
  receiveCustomerAdvance,
  refundCustomerAdvanceSettlement,
  type FinancialSettlementInput,
} from "@/src/services/finance-settlement.service";
import type { FinanceActor } from "@/src/services/financial-center-v2.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function actor(access: { context: { user?: { id?: string; employeeName?: string | null; name?: string | null; email?: string | null } | null } }): FinanceActor {
  return {
    id: access.context.user?.id || null,
    name: access.context.user?.employeeName || access.context.user?.name || access.context.user?.email || "CRM / Фінанси",
  };
}

function serialize(row: any) {
  return {
    ...row,
    amount: Number(row.amount),
    appliedAmount: Number(row.appliedAmount),
    remainingAmount: Math.max(0, Number(row.amount) - Number(row.appliedAmount)),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof FinanceSettlementError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[finance-advances]", error);
  return NextResponse.json({ ok: false, code: "ADVANCE_OPERATION_FAILED", error: "Не вдалося виконати операцію з авансом." }, { status: 500 });
}

async function locationForBody(body: Record<string, unknown>) {
  const direct = text(body.locationId, 64);
  if (direct) return direct;
  const advanceId = text(body.advanceId, 96);
  if (!advanceId) return null;
  const row = await getPrisma().customerAdvance.findUnique({ where: { id: advanceId }, select: { locationId: true } });
  return row?.locationId || null;
}

export async function GET(request: NextRequest) {
  const requestedLocationId = text(request.nextUrl.searchParams.get("locationId"), 64);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const rows = await listFinanceAdvances({
      locationId: requestedLocationId,
      locationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
      clientId: text(request.nextUrl.searchParams.get("clientId"), 64),
    });
    return NextResponse.json({ ok: true, advances: rows.map(serialize) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = asRecord(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Очікується JSON-об’єкт." }, { status: 400 });
  const action = (text(body.action, 48) || "RECEIVE").toUpperCase();
  const requestedLocationId = await locationForBody(body);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const identity = actor(access);
    let result: unknown;
    if (action === "APPLY") {
      const advanceId = text(body.advanceId, 96);
      const workOrderId = text(body.workOrderId, 64);
      if (!advanceId || !workOrderId) throw new FinanceSettlementError("ADVANCE_FIELDS_REQUIRED", "Вкажіть аванс і замовлення.");
      result = await applyCustomerAdvanceSettlement(advanceId, workOrderId, body.amount, body.idempotencyKey, identity);
    } else if (action === "REFUND") {
      const advanceId = text(body.advanceId, 96);
      if (!advanceId) throw new FinanceSettlementError("ADVANCE_ID_REQUIRED", "Вкажіть аванс.");
      result = await refundCustomerAdvanceSettlement(advanceId, identity);
    } else if (action === "RECEIVE" || action === "CREATE") {
      result = await receiveCustomerAdvance(body as FinancialSettlementInput, identity);
    } else {
      throw new FinanceSettlementError("UNKNOWN_ADVANCE_ACTION", "Невідома операція з авансом.");
    }
    return NextResponse.json({ ok: true, result }, { status: action === "RECEIVE" || action === "CREATE" ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
