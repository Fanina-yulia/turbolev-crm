import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { parseWorkOrderNumber } from "@/src/domain/work-order-number";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { resolveVisibleWorkOrderIds } from "@/src/security/work-order-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  const ids = (request.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 500);
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const parsedNumber = q ? parseWorkOrderNumber(q) : null;

  if (!ids.length && parsedNumber == null) {
    return NextResponse.json({ ok: false, error: "Вкажіть ids або номер ЗН." }, { status: 400 });
  }

  try {
    const rows = await getPrisma().workOrderNumber.findMany({
      where: parsedNumber != null ? { number: parsedNumber } : { workOrderId: { in: ids } },
      orderBy: { number: "asc" },
      select: { workOrderId: true, number: true },
    });
    const visible = await resolveVisibleWorkOrderIds(access.context, access.grantedScope);
    const visibleSet = visible ? new Set(visible) : null;
    const allowedRows = visibleSet ? rows.filter((row) => visibleSet.has(row.workOrderId)) : rows;
    return NextResponse.json({ ok: true, rows: allowedRows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-orders/numbers failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити номери ЗН." }, { status: 500 });
  }
}
