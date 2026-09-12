import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  FinanceSettlementError,
  listFinancialSettlements,
  postFinancialSettlement,
  reverseFinancialSettlement,
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

function money(value: unknown) {
  return value == null ? null : Number(value);
}

function serialize(row: any) {
  return {
    ...row,
    amount: money(row.amount),
    allocations: row.allocations?.map((item: any) => ({ ...item, amount: money(item.amount) })) || [],
  };
}

function errorResponse(error: unknown) {
  if (error instanceof FinanceSettlementError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[finance-settlements]", error);
  return NextResponse.json({ ok: false, code: "FINANCE_SETTLEMENT_FAILED", error: "Не вдалося виконати фінансову операцію." }, { status: 500 });
}

async function targetLocation(body: Record<string, unknown>) {
  const direct = text(body.locationId, 64);
  if (direct) return direct;
  const settlementId = text(body.settlementId, 96);
  if (!settlementId) return null;
  const row = await getPrisma().financialSettlement.findUnique({ where: { id: settlementId }, select: { locationId: true } });
  return row?.locationId || null;
}

export async function GET(request: NextRequest) {
  const requestedLocationId = text(request.nextUrl.searchParams.get("locationId"), 64);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const rows = await listFinancialSettlements({
      locationId: requestedLocationId,
      locationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
      type: request.nextUrl.searchParams.get("type"),
      status: request.nextUrl.searchParams.get("status"),
      clientId: text(request.nextUrl.searchParams.get("clientId"), 64),
      supplierId: text(request.nextUrl.searchParams.get("supplierId"), 64),
      workOrderId: text(request.nextUrl.searchParams.get("workOrderId"), 64),
    });
    return NextResponse.json({ ok: true, settlements: rows.map(serialize) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = asRecord(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Очікується JSON-об’єкт." }, { status: 400 });
  const action = (text(body.action, 48) || "POST").toUpperCase();
  const requestedLocationId = await targetLocation(body);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const identity = actor(access);
    if (action === "REVERSE" || action === "REFUND") {
      const settlementId = text(body.settlementId, 96);
      if (!settlementId) throw new FinanceSettlementError("SETTLEMENT_ID_REQUIRED", "Вкажіть платіж.");
      const result = await reverseFinancialSettlement(settlementId, identity);
      return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await postFinancialSettlement(body as FinancialSettlementInput, identity);
    return NextResponse.json({ ok: true, result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
