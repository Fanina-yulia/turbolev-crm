import { NextRequest, NextResponse } from "next/server";
import { WarrantyCostCategory } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CATEGORIES = new Set(Object.values(WarrantyCostCategory));

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function writeScope(context: AccessContext) {
  return context.permissions[PERMISSIONS.WARRANTY_WRITE] as AccessScopeCode | undefined;
}

async function scopedWorkOrderIds(context: AccessContext) {
  if (context.enforcementMode !== "ENFORCED" || writeScope(context) === "ALL") return null;
  if (!context.locationIds.length) return [] as string[];
  const rows = await getPrisma().serviceAppointment.findMany({
    where: { locationId: { in: context.locationIds }, workOrderId: { not: null } },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
    take: 10000,
  });
  return rows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
}

export async function POST(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.WARRANTY_WRITE)) {
    return NextResponse.json({ ok: false, error: "Немає права фіксувати гарантійні витрати." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const claimId = clean(body.claimId, 120);
  const categoryRaw = clean(body.category, 24);
  const note = clean(body.note, 4000) || null;
  const correctiveWorkOrderId = clean(body.correctiveWorkOrderId, 120) || null;
  const sourceEntity = clean(body.sourceEntity, 40) || null;
  const sourceEntityId = clean(body.sourceEntityId, 120) || null;
  const supplierId = clean(body.supplierId, 120) || null;
  const amount = Number(body.amount);

  if (!claimId) return NextResponse.json({ ok: false, error: "Не вибрано гарантійне звернення." }, { status: 400 });
  if (!CATEGORIES.has(categoryRaw as WarrantyCostCategory)) return NextResponse.json({ ok: false, error: "Некоректна категорія витрат." }, { status: 400 });
  if (!Number.isFinite(amount)) return NextResponse.json({ ok: false, error: "Некоректна сума витрат." }, { status: 400 });
  if (amount < 0 && !note) return NextResponse.json({ ok: false, error: "Для коригуючої від’ємної суми обов’язково вкажіть пояснення." }, { status: 400 });

  const prisma = getPrisma();
  try {
    const allowedWorkOrderIds = await scopedWorkOrderIds(context);
    const claim = await prisma.warrantyClaim.findUnique({
      where: { id: claimId },
      select: { id: true, workOrderLine: { select: { workOrderId: true } } },
    });
    if (!claim) return NextResponse.json({ ok: false, error: "Гарантійне звернення не знайдено." }, { status: 404 });
    if (allowedWorkOrderIds && !allowedWorkOrderIds.includes(claim.workOrderLine.workOrderId)) {
      return NextResponse.json({ ok: false, error: "Немає доступу до цього гарантійного звернення." }, { status: 403 });
    }

    if (correctiveWorkOrderId) {
      if (allowedWorkOrderIds && !allowedWorkOrderIds.includes(correctiveWorkOrderId)) {
        return NextResponse.json({ ok: false, error: "Коригувальний наряд поза вашим station-scope." }, { status: 403 });
      }
      const corrective = await prisma.workOrder.findUnique({ where: { id: correctiveWorkOrderId }, select: { id: true } });
      if (!corrective) return NextResponse.json({ ok: false, error: "Коригувальний Work Order не знайдено." }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (correctiveWorkOrderId) {
        await tx.warrantyClaim.update({ where: { id: claimId }, data: { correctiveWorkOrderId } });
      }
      const fact = await tx.warrantyClaimCostFact.create({
        data: {
          warrantyClaimId: claimId,
          category: categoryRaw as WarrantyCostCategory,
          amount,
          currency: "UAH",
          sourceEntity,
          sourceEntityId,
          supplierId,
          note,
          recordedByUserId: context.user?.id || null,
          recordedByName: context.user?.employeeName || context.user?.name || null,
        },
        select: { id: true, category: true, amount: true, currency: true, note: true, recordedAt: true },
      });
      return fact;
    });

    return NextResponse.json({
      ok: true,
      fact: { ...result, amount: result.amount.toString() },
      correctiveWorkOrderId,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POST /api/warranties/costs failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося зафіксувати гарантійні витрати." }, { status: 500 });
  }
}
