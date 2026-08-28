import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { listActiveMechanicAssignments, effectiveAssignmentStatus } from "@/src/services/mechanic-assignments.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TERMINAL_ORDER_STATUSES = new Set(["CLOSED", "CANCELLED"]);

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mechanicWorkflow(metadata: unknown) {
  const workflow = record(record(metadata).mechanicWorkflow);
  const pausedAt = typeof workflow.pausedAt === "string" && workflow.pausedAt ? workflow.pausedAt : null;
  const pauseReason = typeof workflow.pauseReason === "string" ? workflow.pauseReason : null;
  const pauseNote = typeof workflow.pauseNote === "string" ? workflow.pauseNote : null;
  const totalPausedSeconds = Number(workflow.totalPausedSeconds ?? 0);
  return {
    pausedAt,
    pauseReason,
    pauseNote,
    totalPausedSeconds: Number.isFinite(totalPausedSeconds) && totalPausedSeconds > 0 ? Math.floor(totalPausedSeconds) : 0,
  };
}

export async function GET(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED", message: "Доступ доступний лише механіку." }, { status: 403 });
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true },
    });
    if (!mechanic) {
      return NextResponse.json({ ok: true, linked: false, cases: [], kpis: { total: 0, active: 0, inRepair: 0, waitingParts: 0, waitingQc: 0, completedToday: 0 } });
    }

    const mechanicIds = [mechanic.id, access.context.user.id];
    const [assignments, assignedLines] = await Promise.all([
      listActiveMechanicAssignments(mechanic.id),
      prisma.workOrderLine.findMany({
        where: {
          mechanicId: { in: mechanicIds },
          type: { not: "PART" },
          workOrder: { status: { notIn: [...TERMINAL_ORDER_STATUSES] } },
        },
        select: { workOrderId: true },
      }),
    ]);

    const assignmentByOrderId = new Map(assignments.filter((item) => item.workOrderId).map((item) => [item.workOrderId as string, item]));
    const workOrderIds = [...new Set([
      ...assignments.map((item) => item.workOrderId).filter((id): id is string => Boolean(id)),
      ...assignedLines.map((line) => line.workOrderId),
    ])];
    if (!workOrderIds.length) {
      return NextResponse.json({ ok: true, linked: true, cases: [], kpis: { total: 0, active: 0, inRepair: 0, waitingParts: 0, waitingQc: 0, completedToday: 0 } });
    }

    const orders = await prisma.workOrder.findMany({
      where: { id: { in: workOrderIds }, status: { notIn: [...TERMINAL_ORDER_STATUSES] } },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
        diagnosticRequest: { select: { id: true, technicalConclusion: true, confirmedAt: true } },
        lines: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            type: true,
            status: true,
            description: true,
            code: true,
            article: true,
            brand: true,
            unit: true,
            requiredForRepair: true,
            plannedQuantity: true,
            actualQuantity: true,
            laborHours: true,
            mechanicId: true,
            startedAt: true,
            completedAt: true,
            metadata: true,
            sortOrder: true,
          },
        },
        qualityControls: {
          orderBy: { attempt: "desc" },
          take: 1,
          select: { id: true, attempt: true, status: true, resultNote: true, completedAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const cases = orders.map((order) => {
      const assignment = assignmentByOrderId.get(order.id) ?? null;
      const workLines = order.lines.filter((line) => line.type !== "PART" && line.status !== "CANCELLED");
      const parts = order.lines.filter((line) => line.type === "PART" && line.status !== "CANCELLED");
      const assignedWorkLines = workLines.filter((line) => mechanicIds.includes(line.mechanicId || ""));
      const completedCount = workLines.filter((line) => line.status === "COMPLETED").length;
      const workflowLines = workLines.map((line) => {
        const lineWorkflow = mechanicWorkflow(line.metadata);
        return {
          id: line.id,
          type: line.type,
          status: line.status === "IN_PROGRESS" && lineWorkflow.pausedAt ? "PAUSED" : line.status,
          description: line.description,
          code: line.code,
          article: line.article,
          brand: line.brand,
          unit: line.unit,
          requiredForRepair: line.requiredForRepair,
          plannedQuantity: line.plannedQuantity?.toString() ?? null,
          actualQuantity: line.actualQuantity?.toString() ?? null,
          laborHours: line.laborHours?.toString() ?? null,
          mechanicId: line.mechanicId,
          assignedToCurrentMechanic: mechanicIds.includes(line.mechanicId || ""),
          startedAt: line.startedAt,
          completedAt: line.completedAt,
          mechanicWorkflow: lineWorkflow,
        };
      });
      const partLines = parts.map((line) => ({
        id: line.id,
        description: line.description,
        article: line.article,
        brand: line.brand,
        status: line.status,
        unit: line.unit,
        requiredForRepair: line.requiredForRepair,
        plannedQuantity: line.plannedQuantity?.toString() ?? null,
        actualQuantity: line.actualQuantity?.toString() ?? null,
      }));
      const activeLine = assignedWorkLines.find((line) => line.status === "IN_PROGRESS")
        ?? assignedWorkLines.find((line) => line.status === "APPROVED")
        ?? assignedWorkLines.find((line) => line.status === "DRAFT")
        ?? null;
      const status = effectiveAssignmentStatus({
        appointmentStatus: assignment?.appointmentStatus || "READY_FOR_REPAIR",
        workOrderStatus: order.status,
      });
      const requiredLines = workLines.filter((line) => line.requiredForRepair);
      const requiredCompletedCount = requiredLines.filter((line) => line.status === "COMPLETED").length;
      const progressTotal = requiredLines.length || workLines.length;
      const progressCompleted = requiredLines.length ? requiredCompletedCount : completedCount;
      const qualityControl = order.qualityControls[0] ?? null;

      return {
        id: order.id,
        workOrderId: order.id,
        status,
        vehicle: {
          id: order.vehicle.id,
          label: vehicleLabel(order.vehicle),
          plateNumber: order.vehicle.plateNumber,
          vin: order.vehicle.vin,
          mileageKm: order.vehicle.mileageKm,
        },
        client: order.client,
        appointment: assignment ? {
          id: assignment.id,
          status: assignment.appointmentStatus,
          plannedStartAt: assignment.plannedStartAt,
          plannedEndAt: assignment.plannedEndAt,
          post: assignment.postName,
          problem: assignment.problem,
        } : null,
        diagnostic: order.diagnosticRequest,
        progress: {
          completed: progressCompleted,
          total: progressTotal,
          percent: progressTotal ? Math.round((progressCompleted / progressTotal) * 100) : 0,
        },
        lines: workflowLines,
        parts: partLines,
        activeLineId: activeLine?.id ?? null,
        hasAssignedWork: assignedWorkLines.length > 0,
        qualityControl,
        nextAction: status === "READY_FOR_REPAIR" && activeLine?.status === "APPROVED"
          ? "START_REPAIR"
          : status === "IN_REPAIR"
            ? "CONTINUE_REPAIR"
            : status === "WAITING_PARTS"
              ? "WAIT_PARTS"
              : status === "WAITING_QC"
                ? "WAIT_QC"
                : status === "REWORK"
                  ? "REWORK"
                  : "WAIT_MANAGER",
        updatedAt: order.updatedAt,
      };
    });

    const active = cases.filter((item) => !["COMPLETED", "CLOSED", "CANCELLED"].includes(item.status));
    const today = new Date();
    const completedToday = orders.filter((order) => order.lines.some((line) => line.status === "COMPLETED" && line.completedAt && line.completedAt.toDateString() === today.toDateString())).length;
    return NextResponse.json({
      ok: true,
      linked: true,
      cases,
      kpis: {
        total: cases.length,
        active: active.length,
        inRepair: active.filter((item) => ["IN_REPAIR", "REWORK"].includes(item.status)).length,
        waitingParts: active.filter((item) => item.status === "WAITING_PARTS").length,
        waitingQc: active.filter((item) => item.status === "WAITING_QC").length,
        completedToday,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET mechanic repair cases failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_REPAIR_CASES_LOAD_FAILED", message: "Не вдалося завантажити ремонтні справи." }, { status: 500 });
  }
}
