import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

async function mechanicFor(userId: string) {
  return getPrisma().serviceMechanic.findFirst({
    where: { userId, isActive: true },
    select: { id: true, name: true },
  });
}

async function authorizeMechanic(request: Request) {
  const access = await authorize(PERMISSIONS.OVERVIEW_READ, {
    request,
    minimumScope: "SELF",
  });
  if (!access.allowed) return { response: access.response! } as const;
  if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
    return { response: fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403) } as const;
  }
  const mechanic = await mechanicFor(access.context.user.id);
  if (!mechanic) {
    return { response: fail("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409) } as const;
  }
  return { access, mechanic } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await authorizeMechanic(request);
    if ("response" in auth) return auth.response;

    const prisma = getPrisma();
    const [items, unreadCount] = await Promise.all([
      prisma.mechanicNotification.findMany({
        where: { mechanicId: auth.mechanic.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
      prisma.mechanicNotification.count({
        where: { mechanicId: auth.mechanic.id, readAt: null },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      linked: true,
      unreadCount,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        vehicle: item.vehicleLabel || "Автомобіль",
        plate: item.plateNumber || "—",
        appointmentId: item.appointmentId,
        workOrderId: item.workOrderId,
        findingId: item.findingId,
        payload: item.payload,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET mechanic notifications failed", error);
    return fail("Не вдалося завантажити історію сповіщень.", "MECHANIC_NOTIFICATIONS_LOAD_FAILED", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await authorizeMechanic(request);
    if ("response" in auth) return auth.response;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim().slice(0, 128) : "";
    const markAll = body?.all === true;
    if (!markAll && !notificationId) {
      return fail("Не визначено сповіщення.", "NOTIFICATION_ID_REQUIRED");
    }

    const prisma = getPrisma();
    const result = await prisma.mechanicNotification.updateMany({
      where: {
        mechanicId: auth.mechanic.id,
        readAt: null,
        ...(markAll ? {} : { id: notificationId }),
      },
      data: { readAt: new Date() },
    });

    if (!markAll && result.count === 0) {
      const existing = await prisma.mechanicNotification.findFirst({
        where: { id: notificationId, mechanicId: auth.mechanic.id },
        select: { id: true },
      });
      if (!existing) return fail("Сповіщення не знайдено.", "NOTIFICATION_NOT_FOUND", 404);
    }

    const unreadCount = await prisma.mechanicNotification.count({
      where: { mechanicId: auth.mechanic.id, readAt: null },
    });
    return NextResponse.json({ ok: true, updated: result.count, unreadCount });
  } catch (error) {
    console.error("PATCH mechanic notifications failed", error);
    return fail("Не вдалося оновити сповіщення.", "MECHANIC_NOTIFICATION_UPDATE_FAILED", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await authorizeMechanic(request);
    if ("response" in auth) return auth.response;

    const notificationId = new URL(request.url).searchParams.get("notificationId")?.trim().slice(0, 128) || "";
    if (!notificationId) return fail("Не визначено сповіщення.", "NOTIFICATION_ID_REQUIRED");

    const prisma = getPrisma();
    const result = await prisma.mechanicNotification.deleteMany({
      where: { id: notificationId, mechanicId: auth.mechanic.id },
    });
    if (result.count === 0) return fail("Сповіщення не знайдено.", "NOTIFICATION_NOT_FOUND", 404);

    const unreadCount = await prisma.mechanicNotification.count({
      where: { mechanicId: auth.mechanic.id, readAt: null },
    });
    return NextResponse.json({ ok: true, deleted: result.count, unreadCount });
  } catch (error) {
    console.error("DELETE mechanic notification failed", error);
    return fail("Не вдалося видалити сповіщення.", "MECHANIC_NOTIFICATION_DELETE_FAILED", 500);
  }
}
