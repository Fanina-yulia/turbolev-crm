import { NextResponse } from "next/server";
import { getWorkflowStatusLabel } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { resolveVisibleWorkOrderIds } from "@/src/security/work-order-scope";
import { parseWorkOrderNumber } from "@/src/domain/work-order-number";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TERMINAL_LINE_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const POST_REPAIR_STATUSES = new Set(["WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "CLOSED"]);
const PHOTO_KINDS = ["TOOL_FIRST", "TOOL_SECOND", "WORKSPACE_CLEAN"] as const;

type ScopeMode = "ACTIVE" | "COMPLETED" | "ALL";
type PaymentMode = "ALL" | "PAID" | "PARTIAL" | "UNPAID" | "NONE";
type PhotoMode = "ALL" | "COMPLETE" | "MISSING";

function clamp(value: string | null, fallback = 250) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : fallback;
}

function decimal(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function processType(hasDiagnostic: boolean, workCount: number) {
  if (hasDiagnostic && workCount > 0) return "Діагностика + ремонт";
  if (workCount > 0) return "Ремонт";
  return hasDiagnostic ? "Діагностика" : "Сервіс";
}

function paymentState(rows: Array<{ amount: unknown; settledAmount: unknown; status: string }>) {
  if (!rows.length) return { code: "NONE", label: "Немає рахунку", total: 0, paid: 0, outstanding: 0 };
  const total = rows.reduce((sum, row) => sum + decimal(row.amount), 0);
  const paid = rows.reduce((sum, row) => sum + decimal(row.settledAmount), 0);
  const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
  if (outstanding <= 0 || rows.every((row) => ["PAID", "SETTLED", "CLOSED"].includes(row.status))) {
    return { code: "PAID", label: "Оплачено", total, paid, outstanding: 0 };
  }
  if (paid > 0) return { code: "PARTIAL", label: "Частково", total, paid, outstanding };
  return { code: "UNPAID", label: "Не оплачено", total, paid, outstanding };
}

function isoStart(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoEnd(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  try {
    const prisma = getPrisma();
    const url = new URL(request.url);
    const scope = (["ACTIVE", "COMPLETED", "ALL"].includes((url.searchParams.get("scope") || "").toUpperCase())
      ? (url.searchParams.get("scope") || "").toUpperCase()
      : "ACTIVE") as ScopeMode;
    const payment = (["ALL", "PAID", "PARTIAL", "UNPAID", "NONE"].includes((url.searchParams.get("payment") || "").toUpperCase())
      ? (url.searchParams.get("payment") || "").toUpperCase()
      : "ALL") as PaymentMode;
    const photos = (["ALL", "COMPLETE", "MISSING"].includes((url.searchParams.get("photos") || "").toUpperCase())
      ? (url.searchParams.get("photos") || "").toUpperCase()
      : "ALL") as PhotoMode;
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const mechanicId = (url.searchParams.get("mechanicId") || "").trim();
    const workOrderId = (url.searchParams.get("workOrderId") || "").trim();
    const limit = clamp(url.searchParams.get("limit"));
    const from = isoStart(url.searchParams.get("from"));
    const to = isoEnd(url.searchParams.get("to"));
    const visibleIds = await resolveVisibleWorkOrderIds(access.context, access.grantedScope);

    if (visibleIds && visibleIds.length === 0) {
      return NextResponse.json({ ok: true, rows: [], mechanics: [], counts: { active: 0, completed: 0, all: 0, withPhotos: 0, missingPhotos: 0 }, paymentVisible: false }, { headers: { "Cache-Control": "no-store" } });
    }

    const parsedNumber = q ? parseWorkOrderNumber(q) : null;
    const numberMatch = parsedNumber == null ? null : await prisma.workOrderNumber.findUnique({ where: { number: parsedNumber }, select: { workOrderId: true } });
    const where = {
      ...(visibleIds ? { id: { in: visibleIds } } : {}),
      ...(workOrderId ? { id: workOrderId } : {}),
      ...(q ? {
        OR: [
          ...(numberMatch ? [{ id: numberMatch.workOrderId }] : []),
          { client: { is: { name: { contains: q, mode: "insensitive" as const } } } },
          { client: { is: { phone: { contains: q.replace(/\D+/g, "") || q } } } },
          { vehicle: { is: { plateNumber: { contains: q, mode: "insensitive" as const } } } },
          { vehicle: { is: { vin: { contains: q, mode: "insensitive" as const } } } },
          { vehicle: { is: { brand: { contains: q, mode: "insensitive" as const } } } },
          { vehicle: { is: { model: { contains: q, mode: "insensitive" as const } } } },
          { lines: { some: { description: { contains: q, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };

    const workOrders = await prisma.workOrder.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: Math.max(limit * 2, 300),
      select: {
        id: true,
        status: true,
        origin: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
        client: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true } },
        diagnosticRequest: { select: { id: true, status: true, confirmedAt: true } },
        lines: {
          where: { type: { not: "PART" }, status: { not: "CANCELLED" } },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
            mechanicId: true,
            startedAt: true,
            completedAt: true,
            updatedAt: true,
            completionPhotos: {
              orderBy: { updatedAt: "asc" },
              select: { id: true, kind: true, fileName: true, mimeType: true, fileSize: true, createdAt: true, updatedAt: true, createdByUserId: true },
            },
          },
        },
      },
    });

    const ids = workOrders.map((row) => row.id);
    const [numbers, appointments] = await Promise.all([
      ids.length ? prisma.workOrderNumber.findMany({ where: { workOrderId: { in: ids } }, select: { workOrderId: true, number: true } }) : Promise.resolve([]),
      ids.length ? prisma.serviceAppointment.findMany({
        where: { workOrderId: { in: ids } },
        orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "desc" }],
        select: {
          id: true,
          workOrderId: true,
          purpose: true,
          status: true,
          plannedStartAt: true,
          plannedEndAt: true,
          actualArrivalAt: true,
          actualStartAt: true,
          actualEndAt: true,
          locationId: true,
          post: { select: { id: true, name: true } },
          mechanic: { select: { id: true, userId: true, employeeId: true, name: true } },
        },
      }) : Promise.resolve([]),
    ]);

    const numberMap = new Map(numbers.map((row) => [row.workOrderId, row.number]));
    const appointmentMap = new Map<string, (typeof appointments)[number]>();
    for (const appointment of appointments) {
      if (appointment.workOrderId && !appointmentMap.has(appointment.workOrderId)) appointmentMap.set(appointment.workOrderId, appointment);
    }

    const lineMechanicIds = Array.from(new Set(workOrders.flatMap((order) => order.lines.map((line) => line.mechanicId).filter((id): id is string => Boolean(id)))));
    const mechanics = lineMechanicIds.length ? await prisma.serviceMechanic.findMany({
      where: { OR: [{ id: { in: lineMechanicIds } }, { userId: { in: lineMechanicIds } }] },
      select: { id: true, userId: true, employeeId: true, name: true },
    }) : [];
    const mechanicMap = new Map<string, { id: string; name: string }>();
    for (const mechanic of mechanics) {
      mechanicMap.set(mechanic.id, { id: mechanic.id, name: mechanic.name });
      if (mechanic.userId) mechanicMap.set(mechanic.userId, { id: mechanic.id, name: mechanic.name });
    }
    for (const appointment of appointments) {
      if (appointment.mechanic) {
        mechanicMap.set(appointment.mechanic.id, { id: appointment.mechanic.id, name: appointment.mechanic.name });
        if (appointment.mechanic.userId) mechanicMap.set(appointment.mechanic.userId, { id: appointment.mechanic.id, name: appointment.mechanic.name });
      }
    }

    const paymentVisible = hasPermission(access.context, PERMISSIONS.PAYMENTS_READ);
    const obligations = paymentVisible && ids.length ? await prisma.financialObligation.findMany({
      where: { workOrderId: { in: ids }, direction: "RECEIVABLE" },
      select: { workOrderId: true, status: true, amount: true, settledAmount: true },
    }) : [];
    const obligationMap = new Map<string, typeof obligations>();
    for (const obligation of obligations) {
      if (!obligation.workOrderId) continue;
      const current = obligationMap.get(obligation.workOrderId) || [];
      current.push(obligation);
      obligationMap.set(obligation.workOrderId, current);
    }

    const allRows = workOrders.map((order) => {
      const appointment = appointmentMap.get(order.id) ?? null;
      const lines = order.lines;
      const completedCount = lines.filter((line) => line.status === "COMPLETED").length;
      const productionComplete = lines.length > 0 && lines.every((line) => TERMINAL_LINE_STATUSES.has(line.status));
      const completed = productionComplete || POST_REPAIR_STATUSES.has(order.status) || Boolean(order.closedAt);
      const photoLine = [...lines]
        .filter((line) => line.completionPhotos.length > 0)
        .sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime())[0] ?? null;
      const uniquePhotoKinds = new Set(photoLine?.completionPhotos.map((photo) => photo.kind) ?? []);
      const photoCount = PHOTO_KINDS.filter((kind) => uniquePhotoKinds.has(kind)).length;
      const photoSet = photoLine ? {
        lineId: photoLine.id,
        workDescription: photoLine.description,
        mechanic: photoLine.mechanicId ? mechanicMap.get(photoLine.mechanicId) ?? null : appointment?.mechanic ? { id: appointment.mechanic.id, name: appointment.mechanic.name } : null,
        completedAt: photoLine.completedAt,
        count: photoCount,
        complete: photoCount === 3,
        photos: PHOTO_KINDS.map((kind) => photoLine.completionPhotos.find((photo) => photo.kind === kind)).filter((photo): photo is NonNullable<typeof photo> => Boolean(photo)).map((photo) => ({
          id: photo.id,
          kind: photo.kind,
          fileName: photo.fileName,
          fileSize: photo.fileSize,
          createdAt: photo.createdAt,
          updatedAt: photo.updatedAt,
          url: `/api/work-journal/photos/${encodeURIComponent(photo.id)}`,
        })),
      } : null;
      const pay = paymentVisible ? paymentState(obligationMap.get(order.id) || []) : null;
      const mechanic = appointment?.mechanic
        ? { id: appointment.mechanic.id, name: appointment.mechanic.name }
        : lines.map((line) => line.mechanicId ? mechanicMap.get(line.mechanicId) : null).find(Boolean) ?? null;
      const referenceAt = order.closedAt || lines.map((line) => line.completedAt).filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] || appointment?.plannedStartAt || order.updatedAt;
      return {
        id: order.id,
        number: numberMap.get(order.id) ?? null,
        status: order.status,
        statusLabel: getWorkflowStatusLabel("WORK_ORDER", order.status),
        processType: processType(Boolean(order.diagnosticRequest), lines.length),
        client: order.client,
        vehicle: { ...order.vehicle, label: vehicleLabel(order.vehicle) },
        mechanic,
        post: appointment?.post ?? null,
        appointment: appointment ? {
          id: appointment.id,
          purpose: appointment.purpose,
          status: appointment.status,
          plannedStartAt: appointment.plannedStartAt,
          actualArrivalAt: appointment.actualArrivalAt,
          actualStartAt: appointment.actualStartAt,
          actualEndAt: appointment.actualEndAt,
        } : null,
        works: lines.map((line) => ({ id: line.id, description: line.description, status: line.status, startedAt: line.startedAt, completedAt: line.completedAt })),
        workCount: lines.length,
        completedWorkCount: completedCount,
        productionComplete,
        completed,
        payment: pay,
        photoSet,
        photoCount,
        salaryEligible: productionComplete && photoCount === 3,
        referenceAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        closedAt: order.closedAt,
      };
    });

    const filtered = allRows.filter((row) => {
      if (scope === "ACTIVE" && ["CLOSED", "CANCELLED"].includes(row.status)) return false;
      if (scope === "COMPLETED" && !row.completed) return false;
      if (mechanicId && row.mechanic?.id !== mechanicId && row.photoSet?.mechanic?.id !== mechanicId) return false;
      if (photos === "COMPLETE" && row.photoCount !== 3) return false;
      if (photos === "MISSING" && row.photoCount === 3) return false;
      if (payment !== "ALL" && row.payment?.code !== payment) return false;
      const reference = new Date(row.referenceAt);
      if (from && reference < from) return false;
      if (to && reference > to) return false;
      return true;
    }).slice(0, limit);

    const mechanicOptions = Array.from(new Map(allRows.flatMap((row) => [row.mechanic, row.photoSet?.mechanic]).filter((item): item is { id: string; name: string } => Boolean(item)).map((item) => [item.id, item])).values()).sort((a, b) => a.name.localeCompare(b.name, "uk"));

    return NextResponse.json({
      ok: true,
      rows: filtered,
      mechanics: mechanicOptions,
      paymentVisible,
      counts: {
        active: allRows.filter((row) => !["CLOSED", "CANCELLED"].includes(row.status)).length,
        completed: allRows.filter((row) => row.completed).length,
        all: allRows.length,
        withPhotos: allRows.filter((row) => row.photoCount === 3).length,
        missingPhotos: allRows.filter((row) => row.completed && row.photoCount !== 3).length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-journal failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити журнал робіт." }, { status: 500 });
  }
}
