import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  FinanceSettlementError,
  listFinancialPayables,
  postFinancialSettlement,
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

function errorResponse(error: unknown) {
  if (error instanceof FinanceSettlementError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[finance-payables]", error);
  return NextResponse.json({ ok: false, code: "PAYABLE_OPERATION_FAILED", error: "Не вдалося виконати операцію з кредиторкою." }, { status: 500 });
}

function serialize(row: any) {
  return { ...row, amount: Number(row.amount), settledAmount: Number(row.settledAmount), outstanding: Math.max(0, Number(row.amount) - Number(row.settledAmount)) };
}

export async function GET(request: NextRequest) {
  const requestedLocationId = text(request.nextUrl.searchParams.get("locationId"), 64);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const rows = await listFinancialPayables({
      locationId: requestedLocationId,
      locationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
      status: request.nextUrl.searchParams.get("status"),
      supplierId: text(request.nextUrl.searchParams.get("supplierId"), 64),
    });
    return NextResponse.json({ ok: true, payables: rows.map(serialize) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = asRecord(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Очікується JSON-об’єкт." }, { status: 400 });
  const requestedLocationId = text(body.locationId, 64);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const result = await postFinancialSettlement({ ...body, direction: "PAYABLE" } as FinancialSettlementInput, actor(access));
    return NextResponse.json({ ok: true, result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
