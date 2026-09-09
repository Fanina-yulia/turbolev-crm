import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { buildFinancialExport, type FinancialExportKind } from "@/src/services/financial-export.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KYIV_TZ = "Europe/Kyiv";
const KINDS = new Set<FinancialExportKind>(["pnl", "cash-flow", "expenses", "ar", "ap", "plan-fact"]);

function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, timeZoneName: "shortOffset", hour: "2-digit" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 180;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}

function kyivDateStartUtc(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
}

function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return kyivDateStartUtc(year, month, day);
}

function addKyivDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(next);
  return kyivDateStartUtc(
    Number(parts.find((item) => item.type === "year")?.value),
    Number(parts.find((item) => item.type === "month")?.value),
    Number(parts.find((item) => item.type === "day")?.value),
  );
}

function monthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((item) => item.type === "year")?.value);
  const month = Number(parts.find((item) => item.type === "month")?.value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { from: kyivDateStartUtc(year, month, 1), to: kyivDateStartUtc(nextYear, nextMonth, 1) };
}

function slugDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;

  const rawKind = (request.nextUrl.searchParams.get("kind") || "").trim().toLowerCase() as FinancialExportKind;
  if (!KINDS.has(rawKind)) {
    return NextResponse.json({ ok: false, code: "INVALID_EXPORT_KIND", error: "Оберіть коректний фінансовий звіт для експорту." }, { status: 400 });
  }
  const format = (request.nextUrl.searchParams.get("format") || "xlsx").trim().toLowerCase();
  if (format !== "xlsx" && format !== "pdf") {
    return NextResponse.json({ ok: false, code: "INVALID_EXPORT_FORMAT", error: "Підтримуються формати XLSX та PDF." }, { status: 400 });
  }
  if (format === "pdf" && rawKind !== "pnl" && rawKind !== "cash-flow") {
    return NextResponse.json({ ok: false, code: "PDF_NOT_SUPPORTED", error: "PDF доступний для P&L та Cash Flow." }, { status: 400 });
  }

  const defaults = monthRange();
  const from = parseDay(request.nextUrl.searchParams.get("from")) || defaults.from;
  const to = addKyivDay(request.nextUrl.searchParams.get("to")) || defaults.to;
  if (from >= to) {
    return NextResponse.json({ ok: false, code: "INVALID_DATE_RANGE", error: "Некоректний період експорту." }, { status: 400 });
  }

  try {
    const result = await buildFinancialExport(rawKind, format, {
      from,
      to,
      currency: (request.nextUrl.searchParams.get("currency") || "UAH").toUpperCase(),
      locationId: requestedLocationId,
      allowedLocationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
    });
    const safeKind = rawKind.replace(/[^a-z0-9-]/g, "-");
    const filename = `turbo-lev-${safeKind}-${slugDate(from)}-${slugDate(new Date(to.getTime() - 1))}.${result.extension}`;
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/finance/v2/export failed", { kind: rawKind, format, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, code: "FINANCE_EXPORT_FAILED", error: "Не вдалося сформувати фінансовий файл." }, { status: 500 });
  }
}
