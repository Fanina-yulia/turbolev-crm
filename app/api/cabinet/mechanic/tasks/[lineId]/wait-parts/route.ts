import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function PATCH(request: Request, context: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true },
    });
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const mechanicIds = [mechanic.id, access.context.user.id];
    const now = new Date();
    const nowIso = now.toISOString();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ locked: string | null }[]>`SELECT pg_advisory_xact_lock(hashtext(${`mechanic-line:${lineId}`}))::text AS locked`;
      const line = await tx.workOrderLine.findFirst({
        where: { id: lineId, mechanicId: { in: mechanicIds } },
        select: { id: true, workOrderId: true, status: true, type: true, description: true, metadata: true },
      });
      if (!line) throw new Error("ASSIGNED_LINE_NOT_FOUND");
      if (line.type === "PART") throw new Error("PART_LINE_NOT_EXECUTABLE");
      if (line.status !== "IN_PROGRESS") throw new Error("INVALID_WAITING_PARTS_STATE");

      const metadata = record(line.metadata);
      const current = record(metadata.mechanicWorkflow);
      if (current.pausedAt) throw new Error("ALREADY_PAUSED");
      if (current.stopAt) throw new Error("STOPPED_REQUIRES_RESUME");
      const totalPausedSeconds = Number(current.totalPausedSeconds ?? 0);
      const mechanicWorkflow = {
        ...current,
        pausedAt: nowIso,
        pauseReason: "PARTS",
        pauseNote: reason || "Потрібна запчастина",
        lastAction: "WAITING_PARTS",
        lastActionAt: nowIso,
        totalPausedSeconds: Number.isFinite(totalPausedSeconds) && totalPausedSeconds > 0 ? Math.floor(totalPausedSeconds) : 0,
      };

      const row = await tx.workOrderLine.update({
        where: { id: line.id },
        data: { metadata: toPrismaJson({ ...metadata, mechanicWorkflow }) },
        select: { id: true, workOrderId: true, status: true, description: true, metadata: true, startedAt: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId: access.context.user!.id,
          actorName: access.context.user!.employeeName || access.context.user!.name || mechanic.name,
          entityType: "WorkOrderLine",
          entityId: line.id,
          action: "MECHANIC_WAITING_PARTS",
          metadata: toPrismaJson({
            workOrderId: line.workOrderId,
            reason: reason || null,
            scope: "WORK_ORDER_LINE_ONLY",
          }),
        },
      });

      return row;
    });

    return NextResponse.json({
      ok: true,
      line: updated,
      effectiveStatus: "WAITING_PARTS",
      workOrderStatusChanged: false,
      message: "Запчастину запитано. Цю роботу призупинено, інші погоджені роботи залишаються доступними.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ASSIGNED_LINE_NOT_FOUND") return fail("Призначену Вам роботу не знайдено.", message, 404);
    if (message === "PART_LINE_NOT_EXECUTABLE") return fail("Запчастина не є виконуваною роботою.", message, 409);
    if (message === "INVALID_WAITING_PARTS_STATE") return fail("Очікування запчастини можна ввімкнути лише для активної роботи.", message, 409);
    if (message === "ALREADY_PAUSED") return fail("Робота вже призупинена.", message, 409);
    if (message === "STOPPED_REQUIRES_RESUME") return fail("Спочатку відновіть роботу після СТОП.", message, 409);
    console.error("PATCH mechanic line wait-parts failed", error);
    return fail("Не вдалося перевести роботу в очікування запчастини.", "MECHANIC_WAITING_PARTS_FAILED", 500);
  }
}
