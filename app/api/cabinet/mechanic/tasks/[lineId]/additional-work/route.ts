import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { createOperationalBlocker } from "@/src/services/operational-blockers.service";
import { createWorkOrderLine, WorkOrderLineError } from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REQUEST_KINDS = ["ADDITIONAL_WORK", "ADDITIONAL_DIAGNOSTIC", "REPAIR_COMPLICATION"] as const;
const IMPACTS = ["CAN_CONTINUE", "BLOCKS_REPAIR"] as const;
type RequestKind = (typeof REQUEST_KINDS)[number];
type WorkImpact = (typeof IMPACTS)[number];

const KIND_LABELS: Record<RequestKind, string> = {
  ADDITIONAL_WORK: "Додаткова робота",
  ADDITIONAL_DIAGNOSTIC: "Додаткова діагностика",
  REPAIR_COMPLICATION: "Ускладнення під час ремонту",
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]) {
  const normalized = text(value, 64).toUpperCase();
  return (values as readonly string[]).includes(normalized) ? normalized as T[number] : fallback;
}

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null; plateNumber: string | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.plateNumber || "Автомобіль";
}

async function ensureTechnicalDecisionBlocker(input: {
  lineId: string;
  sourceLineId: string;
  workOrderId: string;
  locationId: string;
  appointmentId: string | null;
  vehicleId: string;
  clientId: string | null;
  description: string;
  note: string;
  kind: RequestKind;
  actorUserId: string;
  actorName: string;
}) {
  return createOperationalBlocker({
    code: "TECHNICAL_DECISION",
    priority: "HIGH",
    sourceType: "WORK_ORDER_LINE",
    sourceId: input.lineId,
    locationId: input.locationId,
    appointmentId: input.appointmentId,
    workOrderId: input.workOrderId,
    workOrderLineId: input.lineId,
    vehicleId: input.vehicleId,
    clientId: input.clientId,
    title: `${KIND_LABELS[input.kind]} · потрібне рішення`,
    reason: input.note || input.description,
    nextAction: "Сервіс-менеджеру: оцінити додаткову потребу, сформувати актуальну комерційну пропозицію та погодити її з клієнтом.",
    openedByUserId: input.actorUserId,
    openedByName: input.actorName,
    dueAt: new Date(Date.now() + 30 * 60 * 1000),
    metadata: {
      source: "MECHANIC_ADDITIONAL_WORK",
      requestKind: input.kind,
      impact: "BLOCKS_REPAIR",
      sourceLineId: input.sourceLineId,
      approvalRequired: true,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const description = text(body?.description, 500);
    const note = text(body?.note, 500);
    const kind = enumValue(body?.kind, REQUEST_KINDS, "ADDITIONAL_WORK") as RequestKind;
    const impact = enumValue(body?.impact, IMPACTS, "CAN_CONTINUE") as WorkImpact;
    const hoursValue = body?.laborHours;
    const laborHours = hoursValue == null || hoursValue === "" ? null : Number(hoursValue);
    if (description.length < 3) return fail("Опишіть додаткову роботу або діагностику.", "DESCRIPTION_REQUIRED");
    if (laborHours !== null && (!Number.isFinite(laborHours) || laborHours <= 0 || laborHours > 1000)) {
      return fail("Вкажіть коректну кількість нормо-годин.", "INVALID_LABOR_HOURS");
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true, locationId: true },
    });
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до станції.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const sourceLine = await prisma.workOrderLine.findFirst({
      where: { id: lineId, mechanicId: { in: [mechanic.id, access.context.user.id] }, type: { not: "PART" } },
      select: {
        id: true,
        workOrderId: true,
        status: true,
        workOrder: {
          select: {
            status: true,
            clientId: true,
            vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true } },
          },
        },
      },
    });
    if (!sourceLine) return fail("Роботу не знайдено або вона не закріплена за вами.", "ASSIGNED_LINE_NOT_FOUND", 404);
    if (!["IN_PROGRESS", "PAUSED", "REWORK"].includes(sourceLine.workOrder.status)) {
      return fail("Додаткову потребу можна запропонувати лише під час активного ремонту.", "ADDITIONAL_WORK_NOT_ALLOWED", 409);
    }

    const appointment = await prisma.serviceAppointment.findFirst({
      where: { workOrderId: sourceLine.workOrderId, locationId: mechanic.locationId },
      orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }],
      select: { id: true },
    });

    const duplicate = await prisma.workOrderLine.findFirst({
      where: {
        workOrderId: sourceLine.workOrderId,
        sourceEntity: "MECHANIC_ADDITIONAL_WORK",
        status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS"] },
        description: { equals: description, mode: "insensitive" },
      },
      select: { id: true, status: true, description: true },
    });
    const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name;

    if (duplicate) {
      if (impact === "BLOCKS_REPAIR") {
        await ensureTechnicalDecisionBlocker({
          lineId: duplicate.id,
          sourceLineId: sourceLine.id,
          workOrderId: sourceLine.workOrderId,
          locationId: mechanic.locationId,
          appointmentId: appointment?.id || null,
          vehicleId: sourceLine.workOrder.vehicle.id,
          clientId: sourceLine.workOrder.clientId,
          description,
          note,
          kind,
          actorUserId: access.context.user.id,
          actorName,
        });
      }
      return NextResponse.json({
        ok: true,
        duplicate: true,
        line: duplicate,
        requestKind: kind,
        impact,
        message: "Таку додаткову потребу вже передано на погодження.",
      });
    }

    const created = await createWorkOrderLine(sourceLine.workOrderId, {
      type: "LABOR",
      status: "DRAFT",
      description,
      unit: kind === "ADDITIONAL_DIAGNOSTIC" ? "діагностика" : "робота",
      plannedQuantity: 1,
      plannedUnitPrice: 0,
      plannedUnitCost: 0,
      laborHours: laborHours ?? undefined,
      mechanicId: mechanic.id,
      sourceEntity: "MECHANIC_ADDITIONAL_WORK",
      sourceEntityId: sourceLine.id,
      metadata: {
        source: "MECHANIC_ADDITIONAL_WORK",
        requested: true,
        approvalRequired: true,
        requestKind: kind,
        impact,
        note: note || null,
        requestedByUserId: access.context.user.id,
        requestedByMechanicId: mechanic.id,
        requestedByName: actorName,
        requestedAt: new Date().toISOString(),
      },
    }, actorName);

    let blockerId: string | null = null;
    if (impact === "BLOCKS_REPAIR") {
      const blocker = await ensureTechnicalDecisionBlocker({
        lineId: created.line.id,
        sourceLineId: sourceLine.id,
        workOrderId: sourceLine.workOrderId,
        locationId: mechanic.locationId,
        appointmentId: appointment?.id || null,
        vehicleId: sourceLine.workOrder.vehicle.id,
        clientId: sourceLine.workOrder.clientId,
        description,
        note,
        kind,
        actorUserId: access.context.user.id,
        actorName,
      });
      blockerId = blocker.id;
    }

    await prisma.$transaction(async (tx) => {
      const managers = await tx.userAccessRole.findMany({
        where: { locationId: mechanic.locationId, isActive: true, role: { code: { in: ["STATION_MANAGER", "SERVICE_ADVISOR", "OWNER"] } } },
        select: { userId: true, role: { select: { code: true } } },
      });
      const recipients = Array.from(new Set(managers.map((item) => item.userId).filter((id) => id !== access.context.user!.id)));
      const actionRecipients = Array.from(new Set(managers
        .filter((item) => ["SERVICE_ADVISOR", "STATION_MANAGER"].includes(item.role.code) && item.userId !== access.context.user!.id)
        .map((item) => item.userId)));
      const label = vehicleLabel(sourceLine.workOrder.vehicle);
      const plate = sourceLine.workOrder.vehicle.plateNumber || "Без номера";

      if (recipients.length) {
        await tx.mechanicNotification.createMany({
          data: recipients.map((recipientUserId) => ({
            id: randomUUID(),
            eventKey: `MECHANIC_ADDITIONAL_WORK:${created.line.id}:${recipientUserId}`,
            mechanicId: recipientUserId,
            recipientUserId,
            workOrderId: sourceLine.workOrderId,
            type: "ADDITIONAL_WORK",
            title: impact === "BLOCKS_REPAIR" ? "Ремонт заблоковано: потрібне погодження" : "Потрібне погодження додаткової роботи",
            body: `${label} · ${plate}\n${KIND_LABELS[kind]}: ${description}${note ? `\nКоментар: ${note}` : ""}${impact === "BLOCKS_REPAIR" ? "\n⚠ Подальший ремонт потребує рішення." : ""}`,
            vehicleLabel: label,
            plateNumber: sourceLine.workOrder.vehicle.plateNumber,
            payload: toPrismaJson({
              lineId: created.line.id,
              sourceLineId: sourceLine.id,
              workOrderId: sourceLine.workOrderId,
              approvalRequired: true,
              requestKind: kind,
              impact,
              blockerId,
            }),
          })),
        });
      }

      if (actionRecipients.length) {
        const dueAt = new Date(Date.now() + (impact === "BLOCKS_REPAIR" ? 30 : 60) * 60 * 1000);
        await tx.crmTask.createMany({
          data: actionRecipients.map((assignedUserId) => ({
            id: randomUUID(),
            title: `${KIND_LABELS[kind]} · ${plate}`,
            description: `${description}${note ? `\n${note}` : ""}${impact === "BLOCKS_REPAIR" ? "\nРемонт заблоковано до рішення." : ""}`,
            status: "OPEN",
            priority: impact === "BLOCKS_REPAIR" ? "HIGH" : "MEDIUM",
            assignedUserId,
            createdByUserId: access.context.user!.id,
            dueAt,
            sourceType: "WORK_ORDER_LINE",
            sourceId: created.line.id,
            clientId: sourceLine.workOrder.clientId,
            vehicleId: sourceLine.workOrder.vehicle.id,
            autoGenerated: true,
            dedupeKey: `mechanic-additional:${created.line.id}:${assignedUserId}`,
            metadata: toPrismaJson({
              bucket: "ACTION",
              category: "SERVICE",
              routeSection: "Комерційна пропозиція",
              routeParams: { workOrderId: sourceLine.workOrderId, workOrderTab: "estimate" },
              workOrderId: sourceLine.workOrderId,
              workOrderLineId: created.line.id,
              sourceLineId: sourceLine.id,
              requestKind: kind,
              impact,
              blockerId,
            }),
          })),
          skipDuplicates: true,
        });
      }

      await tx.auditEvent.create({
        data: {
          actorId: access.context.user!.id,
          actorName,
          entityType: "WorkOrderLine",
          entityId: created.line.id,
          action: "MECHANIC_ADDITIONAL_WORK_REQUESTED",
          metadata: toPrismaJson({
            sourceLineId: sourceLine.id,
            workOrderId: sourceLine.workOrderId,
            description,
            laborHours,
            note: note || null,
            requestKind: kind,
            impact,
            blockerId,
            requiredActionRecipients: actionRecipients,
            approvalRequired: true,
          }),
        },
      });
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      line: { id: created.line.id, status: created.line.status, description: created.line.description },
      requestKind: kind,
      impact,
      blockerId,
      message: impact === "BLOCKS_REPAIR"
        ? "Додаткову потребу передано на погодження. Ремонт позначено як такий, що потребує технічного рішення."
        : "Додаткову потребу передано сервіс-менеджеру на погодження. Після погодження вона потрапить у виконання та фінальний документ.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkOrderLineError) {
      const status = ["WORK_ORDER_NOT_FOUND", "LINE_NOT_FOUND"].includes(error.code) ? 404 : error.code === "ACTUAL_ALREADY_LOCKED" ? 409 : 400;
      return fail(error.message, error.code, status);
    }
    console.error("POST mechanic additional work failed", error);
    return fail("Не вдалося передати додаткову потребу.", "ADDITIONAL_WORK_CREATE_FAILED", 500);
  }
}
