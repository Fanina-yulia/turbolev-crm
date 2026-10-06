import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { getFinanceExpenseCenterInventoryFacts } from "@/src/services/finance-expense-center.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";

function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: KYIV_TZ,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 180;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}

function kyivDateStartUtc(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
}

function kyivDateEndUtc(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day + 1, 12));
  return new Date(Date.UTC(year, month - 1, day + 1, 0, -kyivOffsetMinutes(probe)));
}

export async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, locationId);
  if (!access.ok) return access.response;

  const from = kyivDateStartUtc(request.nextUrl.searchParams.get("from"));
  const to = kyivDateEndUtc(request.nextUrl.searchParams.get("to"));
  if (!from || !to || from >= to) {
    return NextResponse.json({ ok: false, code: "INVALID_RANGE", error: "Вкажіть коректний фінансовий період." }, { status: 400 });
  }

  try {
    const facts = await getFinanceExpenseCenterInventoryFacts({
      from,
      to,
      locationId,
      allowedLocationIds: access.grantedScope === "LOCATION" && !locationId
        ? access.allowedLocationIds ?? undefined
        : undefined,
    });
    return NextResponse.json({ ok: true, ...facts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[finance-expense-center]", error);
    return NextResponse.json({
      ok: false,
      code: "EXPENSE_CENTER_LOAD_FAILED",
      error: "Не вдалося завантажити дані закупівель і складу.",
    }, { status: 500 });
  }
}
