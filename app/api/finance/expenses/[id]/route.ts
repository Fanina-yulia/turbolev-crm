import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { FinanceExpenseError, getExpense, updateExpense, type ExpenseDraftInput } from "@/src/services/finance-expenses.service";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function identity(access: { context: { user?: { id?: string; employeeName?: string | null; name?: string | null; email?: string | null } | null } }) {
  return {
    id: access.context.user?.id || null,
    name: access.context.user?.employeeName || access.context.user?.name || access.context.user?.email || "CRM / Фінанси",
  };
}

function errorResponse(error: unknown) {
  if (error instanceof FinanceExpenseError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[finance-expense]", error);
  return NextResponse.json({ ok: false, code: "EXPENSE_OPERATION_FAILED", error: "Не вдалося виконати операцію з витратою." }, { status: 500 });
}

async function scopedExpense(id: string, access: { grantedScope: string; allowedLocationIds: string[] | null }) {
  if (access.grantedScope === "ALL") return true;
  const row = await getPrisma().expenseDocument.findUnique({ where: { id }, select: { locationId: true } });
  return Boolean(row?.locationId && access.allowedLocationIds?.includes(row.locationId));
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, null);
  if (!access.ok) return access.response;
  if (!(await scopedExpense(id, access))) return NextResponse.json({ ok: false, code: "EXPENSE_NOT_FOUND", error: "Витрату не знайдено." }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, expense: await getExpense(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = asRecord(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Очікується JSON-об’єкт." }, { status: 400 });
  const requestedLocationId = typeof body.locationId === "string" ? body.locationId.trim() || null : null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, requestedLocationId);
  if (!access.ok) return access.response;
  if (!(await scopedExpense(id, access))) return NextResponse.json({ ok: false, code: "EXPENSE_NOT_FOUND", error: "Витрату не знайдено." }, { status: 404 });
  try {
    const user = identity(access);
    const effectiveLocationId = requestedLocationId || (access.grantedScope === "LOCATION" && access.allowedLocationIds?.length === 1 ? access.allowedLocationIds[0] : null);
    const expense = await updateExpense(id, { ...body, locationId: effectiveLocationId } as ExpenseDraftInput, user.id, user.name);
    return NextResponse.json({ ok: true, expense });
  } catch (error) {
    return errorResponse(error);
  }
}
