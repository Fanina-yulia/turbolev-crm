import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CLOSED_APPOINTMENT_STATUSES = ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] as const;
const MAX_IMAGE_BYTES = 2_800_000;
const CYR_TO_LAT: Record<string, string> = {
  А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
};
const LAT_TO_CYR: Record<string, string> = {
  A: "А", B: "В", E: "Е", I: "І", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", X: "Х", Y: "У",
};

type NextAction = {
  type: "DIAGNOSTIC" | "REPAIR" | "WAITING" | "NONE";
  label: string;
  diagnosticId?: string | null;
  taskId?: string | null;
  reason?: string | null;
};

function clean(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function canonicalPlate(value: unknown) {
  const source = clean(value, 32).normalize("NFKC").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
  return [...source].map((char) => CYR_TO_LAT[char] || char).join("");
}

function cyrillicPlate(value: string) {
  return [...value].map((char) => LAT_TO_CYR[char] || char).join("");
}

function plateCandidates(raw: string, canonical: string) {
  const values = new Set<string>();
  for (const value of [raw, canonical, cyrillicPlate(canonical)]) {
    const cleaned = clean(value, 32).toUpperCase();
    if (cleaned) values.add(cleaned);
  }
  return [...values];
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null } | null | undefined) {
  if (!vehicle) return "Автомобіль";
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  return "";
}

function parseRecognition(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const plate = clean(parsed.plate, 32);
    const confidenceRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, Math.round(confidenceRaw))) : null;
    return { plate, confidence };
  } catch {
    const plate = cleaned.match(/[A-ZА-ЯІЇЄ]{1,3}[\s-]*\d{3,6}[\s-]*[A-ZА-ЯІЇЄ]{0,3}/i)?.[0] || "";
    return { plate, confidence: null as number | null };
  }
}

async function recognizePlateFromImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("INVALID_IMAGE_TYPE");
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const credentials = await getIntegrationCredential("VEHICLE_IMAGES");
  const apiKey = credentials?.apiKey?.trim();
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6-luna",
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Read the vehicle registration plate visible in this photo. This is for an authorized auto-service workflow. Return exactly one JSON object and no markdown: {\"plate\":\"KA9962TA\",\"confidence\":98}. Preserve digits. For Ukrainian letters that are visually equivalent to Latin plate letters you may return Latin canonical characters. If no plate is readable, return {\"plate\":\"\",\"confidence\":0}.",
            },
            { type: "input_image", image_url: dataUrl, detail: "high" },
          ],
        }],
        max_output_tokens: 80,
      }),
    });
    if (!response.ok) throw new Error("OPENAI_RECOGNITION_FAILED");
    const payload = await response.json().catch(() => null);
    const result = parseRecognition(extractResponseText(payload));
    if (!result.plate) throw new Error("PLATE_NOT_READABLE");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveNextAction(input: {
  userId: string;
  mechanicId: string;
  vehicleId: string | null;
  workOrderId: string | null;
}) : Promise<NextAction> {
  const prisma = getPrisma();
  const diagnostic = input.vehicleId ? await prisma.diagnosticRequest.findFirst({
    where: { vehicleId: input.vehicleId, status: { not: "CANCELLED" } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, status: true },
  }) : null;
  const review = diagnostic ? await prisma.diagnosticReview.findUnique({
    where: { diagnosticRequestId: diagnostic.id },
    select: { state: true },
  }) : null;

  if (diagnostic) {
    const diagnosticOpen = review?.state === "RETURNED"
      || (review?.state !== "SUBMITTED" && review?.state !== "CONFIRMED" && ["PENDING", "IN_PROGRESS"].includes(diagnostic.status));
    if (diagnosticOpen) {
      return {
        type: "DIAGNOSTIC",
        label: diagnostic.status === "PENDING" ? "Почати діагностику" : "Продовжити діагностику",
        diagnosticId: diagnostic.id,
      };
    }
    if (review?.state === "SUBMITTED") {
      return { type: "WAITING", label: "Діагностика передана", diagnosticId: diagnostic.id, reason: "Очікується рішення сервіс-менеджера." };
    }
  }

  if (input.workOrderId) {
    const [workOrder, task] = await Promise.all([
      prisma.workOrder.findUnique({ where: { id: input.workOrderId }, select: { id: true, status: true } }),
      prisma.workOrderLine.findFirst({
        where: {
          workOrderId: input.workOrderId,
          mechanicId: { in: [input.mechanicId, input.userId] },
          type: { not: "PART" },
          status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS"] },
        },
        orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
        select: { id: true, status: true },
      }),
    ]);
    if (task && workOrder && ["READY_FOR_REPAIR", "IN_REPAIR", "REWORK", "PARTS_REVIEW"].includes(workOrder.status)) {
      return {
        type: "REPAIR",
        label: task.status === "IN_PROGRESS" ? "Продовжити ремонт" : "Почати ремонт",
        taskId: task.id,
      };
    }
    if (workOrder && ["WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS"].includes(workOrder.status)) {
      const reason = workOrder.status === "WAITING_PARTS" ? "Очікуються запчастини."
        : workOrder.status === "WAITING_APPROVAL" ? "Очікується погодження клієнта."
          : "Замовлення ще готується до ремонту.";
      return { type: "WAITING", label: reason.replace(/\.$/, ""), reason };
    }
    if (task) return { type: "REPAIR", label: task.status === "IN_PROGRESS" ? "Продовжити роботу" : "Відкрити роботу", taskId: task.id };
  }

  if (!diagnostic) return { type: "WAITING", label: "Очікує діагностику", reason: "Діагностика для цього авто ще не оформлена." };
  return { type: "WAITING", label: "Очікує оформлення ремонту", diagnosticId: diagnostic.id, reason: "Діагностика завершена, але ремонтні операції ще не призначені." };
}

export async function POST(request: NextRequest) {
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true, locationId: true },
    });
    if (!mechanic) return NextResponse.json({ ok: false, error: "MECHANIC_NOT_LINKED", message: "Профіль механіка не прив’язаний до станції." }, { status: 403 });

    const contentType = request.headers.get("content-type") || "";
    let rawPlate = "";
    let confidence: number | null = null;
    let confirm = false;
    let source = "MANUAL";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const image = form.get("image");
      const manualPlate = clean(form.get("plate"), 32);
      confirm = clean(form.get("confirm"), 8).toLowerCase() === "true";
      if (manualPlate) {
        rawPlate = manualPlate;
      } else if (image instanceof File) {
        const recognized = await recognizePlateFromImage(image);
        rawPlate = recognized.plate;
        confidence = recognized.confidence;
        source = "CAMERA_OPENAI";
      }
    } else {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      rawPlate = clean(body.plate, 32);
      confidence = typeof body.confidence === "number" ? Math.round(body.confidence) : null;
      confirm = body.confirm === true;
      source = clean(body.source, 32) || "MANUAL";
    }

    const normalized = canonicalPlate(rawPlate);
    if (normalized.length < 5) return NextResponse.json({ ok: false, error: "PLATE_REQUIRED", message: "Не вдалося визначити номер. Спробуйте ще раз або введіть його вручну." }, { status: 400 });

    const appointments = await prisma.serviceAppointment.findMany({
      where: {
        locationId: mechanic.locationId,
        status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
        plateNumber: { not: null },
      },
      include: { mechanic: { select: { id: true, name: true } }, post: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "asc" }],
      take: 250,
    });
    const appointment = appointments.find((item) => canonicalPlate(item.plateNumber) === normalized) || null;

    let vehicle = appointment?.vehicleId ? await prisma.vehicle.findUnique({
      where: { id: appointment.vehicleId },
      select: { id: true, plateNumber: true, brand: true, model: true, year: true },
    }) : null;

    if (!vehicle) {
      const candidates = plateCandidates(rawPlate, normalized);
      vehicle = await prisma.vehicle.findFirst({
        where: { OR: candidates.map((plate) => ({ plateNumber: { equals: plate, mode: "insensitive" as const } })) },
        select: { id: true, plateNumber: true, brand: true, model: true, year: true },
        orderBy: { updatedAt: "desc" },
      });
    }

    const assignedToMe = Boolean(appointment?.mechanicId && appointment.mechanicId === mechanic.id);
    const nextAction = assignedToMe ? await resolveNextAction({
      userId: access.context.user.id,
      mechanicId: mechanic.id,
      vehicleId: vehicle?.id || appointment?.vehicleId || null,
      workOrderId: appointment?.workOrderId || null,
    }) : { type: "NONE", label: "Авто не закріплене за вами", reason: appointment?.mechanicId ? "Автомобіль призначений іншому механіку." : "Для автомобіля немає вашого активного призначення." } satisfies NextAction;

    if (confirm) {
      if (!assignedToMe || !appointment) {
        return NextResponse.json({ ok: false, error: "VEHICLE_NOT_ASSIGNED", message: "Цей автомобіль не закріплений за вами." }, { status: 403 });
      }
      await prisma.auditEvent.create({
        data: {
          actorId: access.context.user.id,
          actorName: mechanic.name,
          entityType: "ServiceAppointment",
          entityId: appointment.id,
          action: "MECHANIC_VEHICLE_CONFIRMED",
          metadata: toPrismaJson({
            source,
            plate: normalized,
            confidence,
            vehicleId: vehicle?.id || appointment.vehicleId || null,
            workOrderId: appointment.workOrderId || null,
            postId: appointment.postId || null,
            nextAction: nextAction.type,
          }),
        },
      }).catch(() => undefined);
    }

    return NextResponse.json({
      ok: true,
      recognized: true,
      recognition: { raw: rawPlate, plate: normalized, confidence, source },
      vehicle: vehicle ? { id: vehicle.id, label: vehicleLabel(vehicle), plate: vehicle.plateNumber || normalized } : { id: null, label: appointment?.vehicleLabel || "Автомобіль", plate: appointment?.plateNumber || normalized },
      appointment: appointment ? { id: appointment.id, status: appointment.status, post: appointment.post?.name || null, plannedStartAt: appointment.plannedStartAt } : null,
      assignedToMe,
      assignment: appointment ? { mechanicId: appointment.mechanicId || null, isAssigned: Boolean(appointment.mechanicId), isMine: assignedToMe } : null,
      nextAction,
      confirmed: confirm && assignedToMe,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "OPENAI_NOT_CONFIGURED") return NextResponse.json({ ok: false, error: code, message: "Розпізнавання фото не налаштоване. Введіть номер вручну." }, { status: 503 });
    if (code === "IMAGE_TOO_LARGE") return NextResponse.json({ ok: false, error: code, message: "Фото завелике. Сфотографуйте номер ближче." }, { status: 413 });
    if (code === "INVALID_IMAGE_TYPE") return NextResponse.json({ ok: false, error: code, message: "Потрібне фото номерного знака." }, { status: 400 });
    if (code === "PLATE_NOT_READABLE" || code === "OPENAI_RECOGNITION_FAILED") return NextResponse.json({ ok: false, error: code, message: "Не вдалося впевнено прочитати номер. Спробуйте ще раз або введіть номер вручну." }, { status: 422 });
    if (code === "AbortError") return NextResponse.json({ ok: false, error: "RECOGNITION_TIMEOUT", message: "Розпізнавання зайняло надто багато часу. Спробуйте ще раз." }, { status: 504 });
    console.error("POST mechanic vehicle scan failed", error);
    return NextResponse.json({ ok: false, error: "VEHICLE_SCAN_FAILED", message: "Не вдалося перевірити автомобіль." }, { status: 500 });
  }
}
