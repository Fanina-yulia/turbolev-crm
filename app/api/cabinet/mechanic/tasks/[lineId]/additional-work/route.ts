import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { createWorkOrderLine, WorkOrderLineError } from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null; plateNumber: string | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.plateNumber || "Автомобіль";
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
    const hoursValue = body?.laborHours;
    const laborHours = hoursValue == null || hoursValue === "" ? null : Number(hoursValue);
    if (description.length < 3) return fail("Опишіть додаткову роботу.", "DESCRIPTION_REQUIRED");
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
            vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true } },
          },
        },
      },
    });
    if (!sourceLine) return fail("Роботу не знайдено або вона не закріплена за вами.", "ASSIGNED_LINE_NOT_FOUND", 404);
    if (!["IN_PROGRESS", "PAUSED", "REWORK"].includes(sourceLine.workOrder.status)) {
      return fail("Додаткову роботу можна запропонувати лише під час активного ремонту.", "ADDITIONAL_WORK_NOT_ALLOWED", 409);
    }

    const duplicate = await prisma.workOrderLine.findFirst({
      where: {
        workOrderId: sourceLine.workOrderId,
        sourceEntity: "MECHANIC_ADDITIONAL_WORK",
        status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS"] },
        description: { equals: description, mode: "insensitive" },
      },
      select: { id: true, status: true, description: true },
    });
    if (duplicate) {
      return NextResponse.json({ ok: true, duplicate: true, line: duplicate, message: "Таку додаткову роботу вже передано на погодження." });
    }

    const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name;
    const created = await createWorkOrderLine(sourceLine.workOrderId, {
      type: "LABOR",
      status: "DRAFT",
      description,
      unit: "робота",
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
        note: note || null,
        requestedByUserId: access.context.user.id,
        requestedByMechanicId: mechanic.id,
        requestedAt: new Date().toISOString(),
      },
    }, actorName);

    await prisma.$transaction(async (tx) => {
      const managers = await tx.userAccessRole.findMany({
        where: { locationId: mechanic.locationId, isActive: true, role: { code: { in: ["STATION_MANAGER", "SERVICE_ADVISOR", "OWNER"] } } },
        select: { userId: true },
      });
      const recipients = Array.from(new Set(managers.map((item) => item.userId).filter((id) => id !== access.context.user!.id)));
      const label = vehicleLabel(sourceLine.workOrder.vehicle);
      if (recipients.length) {
        await tx.mechanicNotification.createMany({
          data: recipients.map((recipientUserId) => ({
            id: randomUUID(),
            eventKey: `MECHANIC_ADDITIONAL_WORK:${created.line.id}:${recipientUserId}`,
            mechanicId: recipientUserId,
            recipientUserId,
            workOrderId: sourceLine.workOrderId,
            type: "ADDITIONAL_WORK",
            title: "Потрібне погодження додаткової роботи",
            body: `${label} · ${sourceLine.workOrder.vehicle.plateNumber || "Без номера"}\nРобота: ${description}${note ? `\nКоментар: ${note}` : ""}`,
            vehicleLabel: label,
            plateNumber: sourceLine.workOrder.vehicle.plateNumber,
            payload: toPrismaJson({ lineId: created.line.id, sourceLineId: sourceLine.id, workOrderId: sourceLine.workOrderId, approvalRequired: true }),
          })),
        });
      }
      await tx.auditEvent.create({
        data: {
          actorId: access.context.user!.id,
          actorName,
          entityType: "WorkOrderLine",
          entityId: created.line.id,
          action: "MECHANIC_ADDITIONAL_WORK_REQUESTED",
          metadata: toPrismaJson({ sourceLineId: sourceLine.id, workOrderId: sourceLine.workOrderId, description, laborHours, note: note || null, approvalRequired: true }),
        },
      });
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      line: { id: created.line.id, status: created.line.status, description: created.line.description },
      message: "Додаткову роботу передано сервіс-менеджеру на погодження. Після погодження вона потрапить у цей наряд і кінцеву накладну.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkOrderLineError) {
      const status = ["WORK_ORDER_NOT_FOUND", "LINE_NOT_FOUND"].includes(error.code) ? 404 : error.code === "ACTUAL_ALREADY_LOCKED" ? 409 : 400;
      return fail(error.message, error.code, status);
    }
    console.error("POST mechanic additional work failed", error);
    return fail("Не вдалося передати додаткову роботу.", "ADDITIONAL_WORK_CREATE_FAILED", 500);
  }
}
