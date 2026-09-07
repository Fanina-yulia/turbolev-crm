import { NextRequest, NextResponse } from "next/server";
import {
  createExpense,
  FinanceExpenseError,
  listExpenses,
  type ExpenseDraftInput,
} from "@/src/services/finance-expenses.service";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const KYIV_TZ = "Europe/Kyiv";

function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 180;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}

function kyivDateStartUtc(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
}

function dateParts(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function dateStart(value: string | null) {
  const parts = dateParts(value);
  return parts ? kyivDateStartUtc(parts.year, parts.month, parts.day) : null;
}

function dateEnd(value: string | null) {
  const parts = dateParts(value);
  if (!parts) return null;
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
  const nextParts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(next);
  const year = Number(nextParts.find((part) => part.type === "year")?.value);
  const month = Number(nextParts.find((part) => part.type === "month")?.value);
  const day = Number(nextParts.find((part) => part.type === "day")?.value);
  return kyivDateStartUtc(year, month, day);
}

function actor(access: { context: { user?: { id?: string; employeeName?: string | null; name?: string | null; email?: string | null } | null } }) {
  return {
    id: access.context.user?.id || null,
    name: access.context.user?.employeeName || access.context.user?.name || access.context.user?.email || "CRM / Фінанси",
  };
}

function errorResponse(error: unknown) {
  if (error instanceof FinanceExpenseError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  }
  console.error("[finance-expenses]", error);
  return NextResponse.json({ ok: false, code: "EXPENSE_OPERATION_FAILED", error: "Не вдалося виконати операцію з витратою." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const result = await listExpenses({
      from: dateStart(request.nextUrl.searchParams.get("from")),
      to: dateEnd(request.nextUrl.searchParams.get("to")),
      locationId: requestedLocationId,
      locationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds ?? undefined : undefined,
      status: request.nextUrl.searchParams.get("status"),
      paymentStatus: request.nextUrl.searchParams.get("paymentStatus"),
      categoryId: request.nextUrl.searchParams.get("categoryId"),
      search: request.nextUrl.searchParams.get("search")?.trim() || null,
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 50),
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = asRecord(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Очікується JSON-об’єкт." }, { status: 400 });
  const requestedLocationId = typeof body.locationId === "string" ? body.locationId.trim() || null : null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, requestedLocationId);
  if (!access.ok) return access.response;
  try {
    const effectiveLocationId = requestedLocationId || (access.grantedScope === "LOCATION" && access.allowedLocationIds?.length === 1 ? access.allowedLocationIds[0] : null);
    if (access.grantedScope === "LOCATION" && !effectiveLocationId) {
      return NextResponse.json({ ok: false, code: "LOCATION_REQUIRED", error: "Для витрати потрібно вибрати станцію." }, { status: 400 });
    }
    const identity = actor(access);
    const expense = await createExpense({ ...body, locationId: effectiveLocationId } as ExpenseDraftInput, identity.id, identity.name);
    return NextResponse.json({ ok: true, expense }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
