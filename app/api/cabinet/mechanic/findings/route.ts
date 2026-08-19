import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";

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

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
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
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true },
    });
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
