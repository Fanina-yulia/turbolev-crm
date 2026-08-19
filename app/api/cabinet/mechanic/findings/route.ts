import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 3;
const URGENCIES = new Set(["INFO", "SOON", "CRITICAL"]);

function text(value: FormDataEntryValue | null, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function jsonText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

async function mechanicFor(userId: string) {
  return getPrisma().serviceMechanic.findFirst({
    where: { userId, isActive: true },
    select: { id: true, name: true },
  });
}

export async function GET(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const mechanic = await mechanicFor(access.context.user.id);
    if (!mechanic) return NextResponse.json({ ok: true, linked: false, items: [] });

    const prisma = getPrisma();
    const findings = await prisma.mechanicWorkFinding.findMany({
      where: {
        OR: [
          { mechanicUserId: access.context.user.id },
          { mechanicResourceId: mechanic.id },
        ],
        status: "REVIEWED",
        resolutionCode: "CLARIFICATION_REQUIRED",
      },
      orderBy: [{ reviewedAt: "desc" }, { updatedAt: "desc" }],
      take: 20,
    });

    const orderIds = Array.from(new Set(findings.map((item) => item.workOrderId)));
    const lineIds = Array.from(new Set(findings.map((item) => item.workOrderLineId)));
    const [orders, lines] = await Promise.all([
      orderIds.length ? prisma.workOrder.findMany({
        where: { id: { in: orderIds } },
        include: { vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } } },
      }) : [],
      lineIds.length ? prisma.workOrderLine.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, description: true },
      }) : [],
    ]);
    const orderMap = new Map(orders.map((item) => [item.id, item]));
    const lineMap = new Map(lines.map((item) => [item.id, item.description]));

    return NextResponse.json({
      ok: true,
      linked: true,
      items: findings.map((finding) => {
        const order = orderMap.get(finding.workOrderId);
        return {
          id: finding.id,
          workOrderId: finding.workOrderId,
          workOrderLineId: finding.workOrderLineId,
          findingText: finding.findingText,
          recommendation: finding.recommendation,
          urgency: finding.urgency,
          managerComment: finding.managerComment,
          reviewedAt: finding.reviewedAt,
          workDescription: lineMap.get(finding.workOrderLineId) || "Робота за нарядом",
          plate: order?.vehicle.plateNumber || "—",
          vehicle: order ? vehicleLabel(order.vehicle) : "Автомобіль",
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET mechanic clarifications failed", error);
    return fail("Не вдалося завантажити уточнення сервіс-менеджера.", "MECHANIC_CLARIFICATIONS_LOAD_FAILED", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const findingId = jsonText(body?.findingId, 128);
    const reply = jsonText(body?.reply, 2000);
    if (!findingId) return fail("Не визначено несправність.", "FINDING_ID_REQUIRED");
    if (reply.length < 3) return fail("Напишіть уточнення для сервіс-менеджера.", "REPLY_REQUIRED");

    const mechanic = await mechanicFor(access.context.user.id);
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const prisma = getPrisma();
    const finding = await prisma.mechanicWorkFinding.findFirst({
      where: {
        id: findingId,
        OR: [
          { mechanicUserId: access.context.user.id },
          { mechanicResourceId: mechanic.id },
        ],
      },
    });
    if (!finding) return fail("Уточнення не знайдено або воно не Ваше.", "FINDING_NOT_FOUND", 404);
    if (finding.status !== "REVIEWED" || finding.resolutionCode !== "CLARIFICATION_REQUIRED") {
      return fail("Цей запит на уточнення вже закритий або змінений.", "CLARIFICATION_NOT_ACTIVE", 409);
    }

    const now = new Date();
    const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name || "Автомеханік";
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.mechanicWorkFinding.update({
        where: { id: finding.id },
        data: {
          status: "SUBMITTED",
          resolutionCode: "CLARIFICATION_ANSWERED",
          mechanicReply: reply,
          mechanicRepliedAt: now,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "MechanicWorkFinding",
          entityId: finding.id,
          action: "FINDING_CLARIFICATION_ANSWERED",
          before: toPrismaJson(finding),
          after: toPrismaJson(row),
          metadata: toPrismaJson({ workOrderId: finding.workOrderId }),
        },
      });
      return row;
    });

    return NextResponse.json({ ok: true, finding: updated, message: "Уточнення передано сервіс-менеджеру." });
  } catch (error) {
    console.error("PATCH mechanic clarification failed", error);
    return fail("Не вдалося передати уточнення сервіс-менеджеру.", "MECHANIC_CLARIFICATION_REPLY_FAILED", 500);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const form = await request.formData();
    const lineId = text(form.get("lineId"), 128);
    const findingText = text(form.get("findingText"), 2000);
    const recommendation = text(form.get("recommendation"), 2000);
    const urgencyRaw = text(form.get("urgency"), 24).toUpperCase() || "INFO";
    const photos = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);

    if (!lineId) return fail("Не визначено роботу, до якої належить несправність.", "LINE_ID_REQUIRED");
    if (findingText.length < 3) return fail("Опишіть виявлену несправність.", "FINDING_TEXT_REQUIRED");
    if (!URGENCIES.has(urgencyRaw)) return fail("Некоректна терміновість несправності.", "INVALID_URGENCY");
    if (!photos.length) return fail("Додайте щонайменше одне фото несправності.", "PHOTO_REQUIRED");
    if (photos.length > MAX_PHOTOS) return fail(`Можна додати не більше ${MAX_PHOTOS} фото.`, "TOO_MANY_PHOTOS");

    let totalBytes = 0;
    for (const photo of photos) {
      if (!ALLOWED_TYPES.has(photo.type)) return fail("Фото має бути у форматі JPG, PNG або WEBP.", "UNSUPPORTED_FILE", 415);
      if (photo.size > MAX_FILE_BYTES) return fail("Максимальний розмір одного фото — 4 МБ.", "FILE_TOO_LARGE", 413);
      totalBytes += photo.size;
    }
    if (totalBytes > MAX_TOTAL_BYTES) return fail("Загальний розмір фото не може перевищувати 8 МБ.", "FILES_TOO_LARGE", 413);

    const prisma = getPrisma();
    const mechanic = await mechanicFor(access.context.user.id);
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const line = await prisma.workOrderLine.findFirst({
      where: { id: lineId, mechanicId: { in: [mechanic.id, access.context.user.id] } },
      select: { id: true, workOrderId: true, type: true, description: true },
    });
    if (!line) return fail("Призначену Вам роботу не знайдено.", "ASSIGNED_LINE_NOT_FOUND", 404);
    if (line.type === "PART") return fail("Несправність потрібно прив’язати до виконуваної роботи, а не до запчастини.", "INVALID_LINE_TYPE", 409);

    const photoData = await Promise.all(photos.map(async (photo) => ({
      fileName: (photo.name || "finding-photo.jpg").slice(0, 240),
      mimeType: photo.type,
      fileSize: photo.size,
      fileData: new Uint8Array(await photo.arrayBuffer()),
    })));

    const finding = await prisma.mechanicWorkFinding.create({
      data: {
        workOrderId: line.workOrderId,
        workOrderLineId: line.id,
        mechanicUserId: access.context.user.id,
        mechanicResourceId: mechanic.id,
        findingText,
        recommendation: recommendation || null,
        urgency: urgencyRaw as "INFO" | "SOON" | "CRITICAL",
        media: { create: photoData },
      },
      include: { media: { select: { id: true, fileName: true, mimeType: true, fileSize: true } } },
    });

    return NextResponse.json({
      ok: true,
      finding: {
        id: finding.id,
        status: finding.status,
        urgency: finding.urgency,
        findingText: finding.findingText,
        recommendation: finding.recommendation,
        submittedAt: finding.submittedAt,
        media: finding.media.map((item) => ({
          ...item,
          url: `/api/cabinet/findings/${finding.id}/media/${item.id}`,
        })),
      },
      message: "Несправність передано сервіс-менеджеру.",
    }, { status: 201 });
  } catch (error) {
    console.error("POST mechanic finding failed", error);
    return fail("Не вдалося передати несправність сервіс-менеджеру.", "MECHANIC_FINDING_CREATE_FAILED", 500);
  }
}
