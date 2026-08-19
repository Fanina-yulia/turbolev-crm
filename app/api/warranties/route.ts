import { NextRequest, NextResponse } from "next/server";
import { WarrantyClaimStatus } from "@/src/generated/prisma/client";
import { formatWorkOrderNumber, parseWorkOrderNumber } from "@/src/domain/work-order-number";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OPEN_CLAIM_STATUSES: WarrantyClaimStatus[] = [
  WarrantyClaimStatus.OPEN,
  WarrantyClaimStatus.REVIEW,
  WarrantyClaimStatus.APPROVED,
];
const CLAIM_STATUSES = new Set(Object.values(WarrantyClaimStatus));
const DAY_MS = 86_400_000;

function positiveInteger(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function warrantyScope(context: AccessContext) {
  return context.permissions[PERMISSIONS.WARRANTY_READ] as AccessScopeCode | undefined;
}

function canWriteWarranty(context: AccessContext) {
  return context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.WARRANTY_WRITE);
}

async function scopedWorkOrderIds(context: AccessContext) {
  if (context.enforcementMode !== "ENFORCED") return null;
  const scope = warrantyScope(context);
  if (scope === "ALL") return null;
  if ((scope === "LOCATION" || scope === "TEAM") && context.locationIds.length) {
    const appointments = await getPrisma().serviceAppointment.findMany({
      where: { locationId: { in: context.locationIds }, workOrderId: { not: null } },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
      take: 5000,
    });
    return appointments.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  }
  return [] as string[];
}

function addDays(start: Date, days: number | null) {
  return days ? new Date(start.getTime() + days * DAY_MS) : null;
}

function serializeWarrantyStatus(input: {
  warrantyKm: number | null;
  warrantyDays: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  mileageStartKm: number | null;
  currentMileageKm: number | null;
}) {
  const now = new Date();
  const expiresAt = input.endsAt || (input.startsAt ? addDays(input.startsAt, input.warrantyDays) : null);
  const mileageLimitKm = input.mileageStartKm && input.warrantyKm ? input.mileageStartKm + input.warrantyKm : null;
  const daysRemaining = expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS) : null;
  const kmRemaining = mileageLimitKm != null && input.currentMileageKm != null ? mileageLimitKm - input.currentMileageKm : null;
  const expiredByTime = Boolean(expiresAt && expiresAt.getTime() < now.getTime());
  const expiredByMileage = Boolean(mileageLimitKm != null && input.currentMileageKm != null && input.currentMileageKm >= mileageLimitKm);
  const expiringSoon = !expiredByTime && !expiredByMileage && Boolean(
    (daysRemaining != null && daysRemaining >= 0 && daysRemaining <= 30) ||
    (kmRemaining != null && kmRemaining >= 0 && kmRemaining <= 1000),
  );
  const status = !input.startsAt
    ? "PENDING_START"
    : expiredByTime || expiredByMileage
      ? "EXPIRED"
      : expiringSoon
        ? "EXPIRING"
        : "ACTIVE";

  return {
    status,
    expiresAt,
    mileageLimitKm,
    daysRemaining,
    kmRemaining,
    expiredByTime,
    expiredByMileage,
  };
}

async function authorizeWarranty(request: NextRequest, write = false) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return { context, response: NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 }) };
  }
  const permission = write ? PERMISSIONS.WARRANTY_WRITE : PERMISSIONS.WARRANTY_READ;
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, permission)) {
    return { context, response: NextResponse.json({ ok: false, error: write ? "Немає права змінювати гарантійні звернення." : "Немає доступу до гарантій." }, { status: 403 }) };
  }
  return { context, response: null as NextResponse | null };
}

export async function GET(request: NextRequest) {
  const access = await authorizeWarranty(request);
  if (access.response) return access.response;
  const { context } = access;
  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);

  try {
    const allowedWorkOrderIds = await scopedWorkOrderIds(context);
    if (allowedWorkOrderIds && !allowedWorkOrderIds.length) {
      return NextResponse.json({ ok: true, rows: [], counts: { active: 0, expiring: 0, claims: 0, expired: 0 }, canWrite: canWriteWarranty(context) });
    }

    let exactWorkOrderId: string | null = null;
    if (q) {
      const number = parseWorkOrderNumber(q);
      if (number != null) exactWorkOrderId = (await prisma.workOrderNumber.findUnique({ where: { number }, select: { workOrderId: true } }))?.workOrderId || null;
    }

    const lines = await prisma.workOrderLine.findMany({
      where: {
        type: "LABOR",
        status: "COMPLETED",
        workOrder: { is: { closedAt: { not: null } } },
        AND: [
          { OR: [{ warrantyKm: { gt: 0 } }, { warrantyDays: { gt: 0 } }] },
          ...(allowedWorkOrderIds ? [{ workOrderId: { in: allowedWorkOrderIds } }] : []),
          ...(q ? [{ OR: [
            ...(exactWorkOrderId ? [{ workOrderId: exactWorkOrderId }] : []),
            { description: { contains: q, mode: "insensitive" as const } },
            { workOrder: { is: { client: { is: { name: { contains: q, mode: "insensitive" as const } } } } } },
            { workOrder: { is: { client: { is: { phone: { contains: q.replace(/\D+/g, "") || q } } } } } },
            { workOrder: { is: { vehicle: { is: { plateNumber: { contains: q, mode: "insensitive" as const } } } } } },
            { workOrder: { is: { vehicle: { is: { vin: { contains: q, mode: "insensitive" as const } } } } } },
            { workOrder: { is: { vehicle: { is: { brand: { contains: q, mode: "insensitive" as const } } } } } },
            { workOrder: { is: { vehicle: { is: { model: { contains: q, mode: "insensitive" as const } } } } } },
          ] }] : []),
        ],
      },
      orderBy: [{ warrantyEndsAt: "asc" }, { completedAt: "desc" }],
      take: 500,
      select: {
        id: true,
        workOrderId: true,
        description: true,
        code: true,
        completedAt: true,
        warrantyKm: true,
        warrantyDays: true,
        warrantyStartsAt: true,
        warrantyEndsAt: true,
        warrantyMileageStartKm: true,
        workOrder: {
          select: {
            id: true,
            status: true,
            closedAt: true,
            client: { select: { id: true, name: true, phone: true } },
            vehicle: { select: { id: true, plateNumber: true, vin: true, brand: true, model: true, year: true, mileageKm: true } },
          },
        },
        warrantyClaims: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, status: true, reason: true, mileageKmAtClaim: true, resolution: true, openedByName: true, closedAt: true, createdAt: true, updatedAt: true },
        },
      },
    });

    const workOrderIds = Array.from(new Set(lines.map((line) => line.workOrderId)));
    const numberRows = workOrderIds.length
      ? await prisma.workOrderNumber.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { workOrderId: true, number: true } })
      : [];
    const numbers = new Map(numberRows.map((row) => [row.workOrderId, row.number]));

    const rows = lines.map((line) => {
      const warrantyKm = positiveInteger(line.warrantyKm);
      const warrantyDays = positiveInteger(line.warrantyDays);
      const startsAt = line.warrantyStartsAt || line.completedAt;
      const currentMileageKm = positiveInteger(line.workOrder.vehicle.mileageKm);
      const warranty = serializeWarrantyStatus({
        warrantyKm,
        warrantyDays,
        startsAt,
        endsAt: line.warrantyEndsAt,
        mileageStartKm: positiveInteger(line.warrantyMileageStartKm),
        currentMileageKm,
      });
      const openClaim = line.warrantyClaims.find((claim) => OPEN_CLAIM_STATUSES.includes(claim.status)) || null;
      return {
        lineId: line.id,
        workOrderId: line.workOrderId,
        workOrderNumber: numbers.get(line.workOrderId) ?? null,
        workOrderLabel: formatWorkOrderNumber(numbers.get(line.workOrderId)),
        workOrderStatus: line.workOrder.status,
        workOrderClosedAt: line.workOrder.closedAt,
        description: line.description,
        code: line.code,
        warrantyKm,
        warrantyDays,
        startsAt,
        expiresAt: warranty.expiresAt,
        mileageStartKm: positiveInteger(line.warrantyMileageStartKm),
        mileageLimitKm: warranty.mileageLimitKm,
        currentMileageKm,
        daysRemaining: warranty.daysRemaining,
        kmRemaining: warranty.kmRemaining,
        warrantyStatus: warranty.status,
        expiredByTime: warranty.expiredByTime,
        expiredByMileage: warranty.expiredByMileage,
        client: line.workOrder.client,
        vehicle: line.workOrder.vehicle,
        openClaim,
        claims: line.warrantyClaims,
      };
    });

    const counts = {
      active: rows.filter((row) => row.warrantyStatus === "ACTIVE" || row.warrantyStatus === "EXPIRING").length,
      expiring: rows.filter((row) => row.warrantyStatus === "EXPIRING").length,
      claims: rows.filter((row) => Boolean(row.openClaim)).length,
      expired: rows.filter((row) => row.warrantyStatus === "EXPIRED").length,
    };

    return NextResponse.json({ ok: true, rows, counts, canWrite: canWriteWarranty(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/warranties failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити гарантійний центр." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorizeWarranty(request, true);
  if (access.response) return access.response;
  const { context } = access;
  const prisma = getPrisma();
  const body = await request.json().catch(() => ({}));
  const workOrderLineId = typeof body.workOrderLineId === "string" ? body.workOrderLineId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 4000) : "";
  const mileageKmAtClaim = body.mileageKmAtClaim == null || body.mileageKmAtClaim === "" ? null : positiveInteger(body.mileageKmAtClaim);
  if (!workOrderLineId) return NextResponse.json({ ok: false, error: "Не вибрано гарантійну роботу." }, { status: 400 });
  if (reason.length < 5) return NextResponse.json({ ok: false, error: "Опишіть причину звернення хоча б кількома словами." }, { status: 400 });
  if (body.mileageKmAtClaim != null && body.mileageKmAtClaim !== "" && !mileageKmAtClaim) return NextResponse.json({ ok: false, error: "Пробіг має бути додатним числом." }, { status: 400 });

  try {
    const allowedWorkOrderIds = await scopedWorkOrderIds(context);
    const line = await prisma.workOrderLine.findUnique({
      where: { id: workOrderLineId },
      select: {
        id: true,
        workOrderId: true,
        type: true,
        status: true,
        warrantyKm: true,
        warrantyDays: true,
        workOrder: { select: { closedAt: true } },
        warrantyClaims: { where: { status: { in: OPEN_CLAIM_STATUSES } }, select: { id: true, status: true }, take: 1 },
      },
    });
    if (!line || line.type !== "LABOR" || line.status !== "COMPLETED" || !line.workOrder.closedAt || (!positiveInteger(line.warrantyKm) && !positiveInteger(line.warrantyDays))) {
      return NextResponse.json({ ok: false, error: "Ця робота не має чинної гарантійної картки." }, { status: 404 });
    }
    if (allowedWorkOrderIds && !allowedWorkOrderIds.includes(line.workOrderId)) return NextResponse.json({ ok: false, error: "Немає доступу до цього ЗН." }, { status: 403 });
    if (line.warrantyClaims.length) return NextResponse.json({ ok: false, error: "По цій роботі вже є відкрите гарантійне звернення." }, { status: 409 });

    const claim = await prisma.warrantyClaim.create({
      data: {
        workOrderLineId,
        reason,
        mileageKmAtClaim,
        openedByUserId: context.user?.id || null,
        openedByName: context.user?.employeeName || context.user?.name || null,
      },
      select: { id: true, status: true, reason: true, mileageKmAtClaim: true, openedByName: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ ok: true, claim }, { status: 201 });
  } catch (error) {
    console.error("POST /api/warranties failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося зареєструвати гарантійне звернення." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const access = await authorizeWarranty(request, true);
  if (access.response) return access.response;
  const { context } = access;
  const prisma = getPrisma();
  const body = await request.json().catch(() => ({}));
  const claimId = typeof body.claimId === "string" ? body.claimId.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() as WarrantyClaimStatus : null;
  const resolution = typeof body.resolution === "string" ? body.resolution.trim().slice(0, 4000) : null;
  if (!claimId) return NextResponse.json({ ok: false, error: "Не вибрано звернення." }, { status: 400 });
  if (!status || !CLAIM_STATUSES.has(status)) return NextResponse.json({ ok: false, error: "Некоректний статус звернення." }, { status: 400 });

  try {
    const allowedWorkOrderIds = await scopedWorkOrderIds(context);
    const claim = await prisma.warrantyClaim.findUnique({
      where: { id: claimId },
      select: { id: true, workOrderLine: { select: { workOrderId: true } } },
    });
    if (!claim) return NextResponse.json({ ok: false, error: "Гарантійне звернення не знайдено." }, { status: 404 });
    if (allowedWorkOrderIds && !allowedWorkOrderIds.includes(claim.workOrderLine.workOrderId)) return NextResponse.json({ ok: false, error: "Немає доступу до цього звернення." }, { status: 403 });

    const terminal = status === WarrantyClaimStatus.CLOSED || status === WarrantyClaimStatus.REJECTED;
    const updated = await prisma.warrantyClaim.update({
      where: { id: claimId },
      data: {
        status,
        ...(resolution !== null ? { resolution: resolution || null } : {}),
        closedAt: terminal ? new Date() : null,
      },
      select: { id: true, status: true, resolution: true, closedAt: true, updatedAt: true },
    });
    return NextResponse.json({ ok: true, claim: updated });
  } catch (error) {
    console.error("PATCH /api/warranties failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося оновити гарантійне звернення." }, { status: 500 });
  }
}
