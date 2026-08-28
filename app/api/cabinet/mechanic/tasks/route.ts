import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function workflow(value: unknown) {
  const data = record(record(value).mechanicWorkflow);
  const pausedAt = typeof data.pausedAt === "string" && data.pausedAt ? data.pausedAt : null;
  const pauseReason = typeof data.pauseReason === "string" && data.pauseReason ? data.pauseReason : null;
  const pauseNote = typeof data.pauseNote === "string" && data.pauseNote ? data.pauseNote : null;
  const total = Number(data.totalPausedSeconds ?? 0);
  return { pausedAt, pauseReason, pauseNote, totalPausedSeconds: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0 };
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

async function kyivDayRange() {
  const rows = await getPrisma().$queryRawUnsafe<Array<{ startAt: Date; endAt: Date }>>(`
    SELECT
      (date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv') AS "startAt",
      ((date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') + interval '1 day') AT TIME ZONE 'Europe/Kyiv') AS "endAt"
  `);
  return rows[0] ?? { startAt: new Date(Date.now() - 12 * 60 * 60 * 1000), endAt: new Date(Date.now() + 36 * 60 * 60 * 1000) };
}

export async function GET(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true },
    });
    if (!mechanic) return NextResponse.json({ ok: true, linked: false, items: [], kpis: { assigned: 0, inProgress: 0, paused: 0, completedToday: 0 } });

    const { startAt, endAt } = await kyivDayRange();
    const lines = await prisma.workOrderLine.findMany({
      where: {
        mechanicId: { in: [mechanic.id, access.context.user.id] },
        type: { not: "PART" },
        OR: [
          { status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS"] } },
          { status: "COMPLETED", completedAt: { gte: startAt, lt: endAt } },
        ],
      },
      include: { workOrder: { include: { vehicle: true } } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 60,
    });

    const findingRows = lines.length ? await prisma.mechanicWorkFinding.findMany({
      where: { workOrderLineId: { in: lines.map((line) => line.id) } },
      select: { workOrderLineId: true, status: true },
    }) : [];
    const findingCounts = new Map<string, number>();
    const openFindingCounts = new Map<string, number>();
    for (const finding of findingRows) {
      findingCounts.set(finding.workOrderLineId, (findingCounts.get(finding.workOrderLineId) ?? 0) + 1);
      if (["SUBMITTED", "REVIEWED"].includes(finding.status)) {
        openFindingCounts.set(finding.workOrderLineId, (openFindingCounts.get(finding.workOrderLineId) ?? 0) + 1);
      }
    }

    const items = lines.map((line) => {
      const state = workflow(line.metadata);
      const effectiveStatus = line.status === "IN_PROGRESS" && state.pausedAt ? "PAUSED" : line.status;
      return {
        id: line.id,
        workOrderId: line.workOrderId,
        description: line.description,
        status: effectiveStatus,
        lineStatus: line.status,
        type: line.type,
        laborHours: line.laborHours?.toString() ?? null,
        plate: line.workOrder.vehicle.plateNumber || "—",
        vehicle: vehicleLabel(line.workOrder.vehicle),
        workOrderStatus: line.workOrder.status,
        startedAt: line.startedAt,
        completedAt: line.completedAt,
        pausedAt: state.pausedAt,
        pauseReason: state.pauseReason,
        pauseNote: state.pauseNote,
        totalPausedSeconds: state.totalPausedSeconds,
        findingCount: findingCounts.get(line.id) ?? 0,
        openFindingCount: openFindingCounts.get(line.id) ?? 0,
        updatedAt: line.updatedAt,
      };
    });

    const active = items.filter((item) => item.lineStatus !== "COMPLETED");
    return NextResponse.json({
      ok: true,
      linked: true,
      items,
      kpis: {
        assigned: active.length,
        inProgress: active.filter((item) => item.status === "IN_PROGRESS").length,
        paused: active.filter((item) => item.status === "PAUSED").length,
        completedToday: items.filter((item) => item.lineStatus === "COMPLETED").length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET mechanic tasks failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_TASKS_LOAD_FAILED", message: "Не вдалося завантажити призначені роботи." }, { status: 500 });
  }
}
