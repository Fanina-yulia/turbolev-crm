import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { FinanceExpenseError, type ExpensePostingInput } from "@/src/services/finance-expenses.service";
import { postExpenseV2 } from "@/src/services/finance-expense-posting-v2.service";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorResponse(error: unknown) {
  if (error instanceof FinanceExpenseError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[finance-expense-post-v2]", error);
  return NextResponse.json({ ok: false, code: "EXPENSE_POST_FAILED", error: "Не вдалося провести витрату." }, { status: 500 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, null);
  if (!access.ok) return access.response;
  if (access.grantedScope !== "ALL") {
    const row = await getPrisma().expenseDocument.findUnique({ where: { id }, select: { locationId: true } });
    if (!row?.locationId || !access.allowedLocationIds?.includes(row.locationId)) {
      return NextResponse.json({ ok: false, code: "EXPENSE_NOT_FOUND", error: "Витрату не знайдено." }, { status: 404 });
    }
  }
  const body = asRecord(await request.json().catch(() => null)) || {};
  try {
    const user = access.context.user;
    const result = await postExpenseV2(id, body as ExpensePostingInput, user?.id || null, user?.employeeName || user?.name || user?.email || "CRM / Фінанси");
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
