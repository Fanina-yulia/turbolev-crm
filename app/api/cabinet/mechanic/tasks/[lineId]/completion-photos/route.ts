import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PHOTO_SPECS = [
  { key: "toolPhoto1", kind: "TOOL_FIRST" as const, label: "інструменти 1" },
  { key: "toolPhoto2", kind: "TOOL_SECOND" as const, label: "інструменти 2" },
  { key: "workspacePhoto", kind: "WORKSPACE_CLEAN" as const, label: "прибрана зона поста" },
] as const;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 4 * 1024 * 1024;

function fail(message: string, code: string, status = 400) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true },
    });
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const line = await prisma.workOrderLine.findFirst({
      where: { id: lineId, mechanicId: { in: [mechanic.id, access.context.user.id] }, type: { not: "PART" } },
      select: { id: true, workOrderId: true, description: true, status: true },
    });
    if (!line) return fail("Призначену Вам роботу не знайдено.", "ASSIGNED_LINE_NOT_FOUND", 404);
    if (line.status !== "IN_PROGRESS") {
      return fail("Фінальні фото можна додати лише до активної роботи до її завершення.", "COMPLETION_PHOTOS_IMMUTABLE", 409);
    }

    const form = await request.formData();
    const files = PHOTO_SPECS
      .map((spec) => ({ spec, file: form.get(spec.key) }))
      .filter(({ file }) => file instanceof File && file.size > 0) as Array<{ spec: typeof PHOTO_SPECS[number]; file: File }>;

    if (!files.length) return fail("Додайте хоча б одне фото завершення ремонту.", "COMPLETION_PHOTO_REQUIRED", 400);

    for (const { file } of files) {
      if (!IMAGE_TYPES.has(file.type)) return fail("Дозволені лише JPG, PNG або WEBP.", "COMPLETION_PHOTO_TYPE_INVALID", 400);
      if (file.size > MAX_FILE_SIZE) return fail("Розмір одного підготовленого фото не може перевищувати 4 МБ.", "COMPLETION_PHOTO_TOO_LARGE", 413);
    }

    const actorId = access.context.user.id;
    const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name;
    await prisma.$transaction(async (tx) => {
      for (const { spec, file } of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        await tx.workOrderCompletionPhoto.upsert({
          where: { workOrderLineId_kind: { workOrderLineId: line.id, kind: spec.kind } },
          create: {
            id: randomUUID(),
            workOrderId: line.workOrderId,
            workOrderLineId: line.id,
            kind: spec.kind,
            fileName: file.name.slice(0, 255) || `${spec.key}.jpg`,
            mimeType: file.type,
            fileSize: buffer.byteLength,
            fileData: buffer,
            createdByUserId: actorId,
          },
          update: {
            fileName: file.name.slice(0, 255) || `${spec.key}.jpg`,
            mimeType: file.type,
            fileSize: buffer.byteLength,
            fileData: buffer,
            createdByUserId: actorId,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId,
            actorName,
            entityType: "WorkOrderLine",
            entityId: line.id,
            action: "MECHANIC_REPAIR_COMPLETION_PHOTO_UPLOADED",
            metadata: toPrismaJson({
              workOrderId: line.workOrderId,
              lineId: line.id,
              kind: spec.kind,
              fileSize: buffer.byteLength,
            }),
          },
        });
      }
    });

    const count = await prisma.workOrderCompletionPhoto.count({
      where: { workOrderLineId: line.id, kind: { in: ["TOOL_FIRST", "TOOL_SECOND", "WORKSPACE_CLEAN"] } },
    });

    return NextResponse.json({
      ok: true,
      lineId: line.id,
      uploaded: files.map(({ spec }) => spec.kind),
      count,
      complete: count === PHOTO_SPECS.length,
      message: count === PHOTO_SPECS.length ? "3/3 фото збережено. Тепер ремонт можна завершити." : `Фото збережено: ${count}/3.`,
    });
  } catch (cause) {
    console.error("POST mechanic completion photos failed", cause);
    return fail("Не вдалося зберегти фото завершення ремонту.", "COMPLETION_PHOTOS_UPLOAD_FAILED", 500);
  }
}
