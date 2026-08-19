import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

async function mechanicFor(userId: string) {
  return getPrisma().serviceMechanic.findFirst({
    where: { userId, isActive: true },
    select: { id: true, name: true, locationId: true },
  });
}

export async function GET(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.OVERVIEW_READ, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const mechanic = await mechanicFor(access.context.user.id);
    if (!mechanic) return NextResponse.json({ ok: true, advisor: null });

    const prisma = getPrisma();
    const advisorRole = await prisma.accessRole.findUnique({ where: { code: "SERVICE_ADVISOR" }, select: { id: true } });
    if (!advisorRole) return NextResponse.json({ ok: true, advisor: null });

    const assignments = await prisma.userAccessRole.findMany({
      where: {
        roleId: advisorRole.id,
        locationId: mechanic.locationId,
        isActive: true,
        user: { isActive: true },
      },
      include: { user: { include: { employeeProfile: true } } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      take: 8,
    });

    const advisor = assignments
      .map((item) => item.user)
      .find((user) => user.employeeProfile?.isActive !== false && Boolean(user.employeeProfile?.phone?.trim()));

    return NextResponse.json({
      ok: true,
      advisor: advisor
        ? {
            name: advisor.employeeProfile
              ? `${advisor.employeeProfile.firstName} ${advisor.employeeProfile.lastName}`.trim()
              : advisor.name,
            phone: advisor.employeeProfile?.phone?.trim() || null,
          }
        : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET mechanic support failed", error);
    return fail("Не вдалося знайти контакт сервіс-менеджера.", "MECHANIC_SUPPORT_LOAD_FAILED", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const lineId = typeof body?.lineId === "string" ? body.lineId.trim().slice(0, 128) : "";
    const kind = body?.kind === "PART_REQUEST" ? "PART_REQUEST" : body?.kind === "QUESTION" ? "QUESTION" : "";
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";
    if (!lineId) return fail("Не визначено роботу.", "LINE_ID_REQUIRED");
    if (!kind) return fail("Оберіть тип звернення.", "SUPPORT_KIND_REQUIRED");
    if (text.length < 3) return fail("Опишіть запит сервіс-менеджеру.", "SUPPORT_TEXT_REQUIRED");

    const mechanic = await mechanicFor(access.context.user.id);
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const prisma = getPrisma();
    const line = await prisma.workOrderLine.findFirst({
      where: { id: lineId, mechanicId: { in: [mechanic.id, access.context.user.id] } },
      select: { id: true, workOrderId: true, description: true },
    });
    if (!line) return fail("Призначену Вам роботу не знайдено.", "ASSIGNED_LINE_NOT_FOUND", 404);

    const finding = await prisma.mechanicWorkFinding.create({
      data: {
        workOrderId: line.workOrderId,
        workOrderLineId: line.id,
        mechanicUserId: access.context.user.id,
        mechanicResourceId: mechanic.id,
        findingText: text,
        recommendation: kind === "PART_REQUEST" ? "Запит на запчастину від автомеханіка" : "Питання сервіс-менеджеру",
        urgency: kind === "PART_REQUEST" ? "SOON" : "INFO",
        resolutionCode: kind,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorName: access.context.user.employeeName || access.context.user.name || mechanic.name,
        entityType: "MechanicWorkFinding",
        entityId: finding.id,
        action: kind === "PART_REQUEST" ? "MECHANIC_PART_REQUESTED" : "MECHANIC_QUESTION_CREATED",
        after: toPrismaJson(finding),
        metadata: toPrismaJson({ workOrderId: line.workOrderId, workOrderLineId: line.id, workDescription: line.description }),
      },
    });

    return NextResponse.json({
      ok: true,
      id: finding.id,
      message: kind === "PART_REQUEST" ? "Запит на запчастину передано сервіс-менеджеру." : "Питання передано сервіс-менеджеру.",
    }, { status: 201 });
  } catch (error) {
    console.error("POST mechanic support failed", error);
    return fail("Не вдалося передати звернення сервіс-менеджеру.", "MECHANIC_SUPPORT_CREATE_FAILED", 500);
  }
}
