import { DiagnosticRequestStatus, Prisma } from "@/src/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { addDateKey, zonedDateKey, zonedDateTimeToDate } from "@/src/lib/zoned-time";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { arrivePlannerAppointment } from "@/src/services/planner-arrival.service";
import { startStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";

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

type ScanScenario = "ASSIGNED" | "ASSIGNED_TO_OTHER" | "WALK_IN_EXISTING_VEHICLE" | "WALK_IN_NEW_VEHICLE";
type NextAction = {
  type: "DIAGNOSTIC" | "REPAIR" | "WAITING" | "NONE";
  label: string;
  diagnosticId?: string | null;
  taskId?: string | null;
  reason?: string | null;
};

class ScanContinuationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "ScanContinuationError";
    this.code = code;
    this.status = status;
  }
}

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

function appointmentWindow(now: Date, timezone: string) {
  const centerDay = zonedDateKey(now, timezone);
  return {
    from: zonedDateTimeToDate(addDateKey(centerDay, -5), "00:00", timezone),
    to: zonedDateTimeToDate(addDateKey(centerDay, 6), "00:00", timezone),
  };
}

async function continueAssignedAppointmentDiagnostic(input: {
  userId: string;
  mechanic: { id: string; name: string; locationId: string };
  appointmentId: string;
}) {
  const prisma = getPrisma();
  const diagnosticRequestId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mechanic-scan-continue:${input.appointmentId}`}))`;
    const appointment = await tx.serviceAppointment.findUnique({ where: { id: input.appointmentId } });
    if (!appointment || appointment.locationId !== input.mechanic.locationId || ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"].includes(appointment.status)) {
      throw new ScanContinuationError("APPOINTMENT_NOT_ACTIVE", "Актуальний запис автомобіля не знайдено.", 404);
    }

    const linkedVisitRows = await tx.$queryRaw<Array<{ diagnosticRequestId: string }>>`
      SELECT "diagnosticRequestId" FROM "DiagnosticVisitLink" WHERE "appointmentId" = ${appointment.id} LIMIT 1
    `;
    const linkedVisit = linkedVisitRows[0] || null;
    let diagnostic = linkedVisit
      ? await tx.diagnosticRequest.findFirst({ where: { id: linkedVisit.diagnosticRequestId, status: { not: DiagnosticRequestStatus.CANCELLED } } })
      : null;
    diagnostic = diagnostic || (appointment.workOrderId
      ? await tx.diagnosticRequest.findFirst({ where: { workOrder: { is: { id: appointment.workOrderId } }, status: { not: DiagnosticRequestStatus.CANCELLED } }, orderBy: { updatedAt: "desc" } })
      : null);
    if (!diagnostic && appointment.vehicleId) {
      diagnostic = await tx.diagnosticRequest.findFirst({ where: { vehicleId: appointment.vehicleId, status: { not: DiagnosticRequestStatus.CANCELLED } }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] });
    }
    if (!diagnostic) {
      if (!appointment.clientId || !appointment.vehicleId) {
        throw new ScanContinuationError("CLIENT_VEHICLE_REQUIRED", "У записі не вказані клієнт або автомобіль. Потрібна перевірка сервіс-менеджера.");
      }
      diagnostic = await tx.diagnosticRequest.create({ data: { clientId: appointment.clientId, vehicleId: appointment.vehicleId, status: DiagnosticRequestStatus.PENDING } });
    }

    const review = await tx.diagnosticReview.findUnique({ where: { diagnosticRequestId: diagnostic.id }, select: { state: true } });
    if (diagnostic.status === DiagnosticRequestStatus.CONFIRMED || review?.state === "SUBMITTED" || review?.state === "CONFIRMED") {
      throw new ScanContinuationError("DIAGNOSTIC_LOCKED", "Ця діагностика вже завершена або передана сервіс-менеджеру.");
    }

    const previousAssignment = await tx.diagnosticAssignment.findUnique({ where: { diagnosticRequestId: diagnostic.id }, select: { mechanicId: true, locationId: true } });
    await tx.diagnosticAssignment.upsert({
      where: { diagnosticRequestId: diagnostic.id },
      create: { diagnosticRequestId: diagnostic.id, locationId: input.mechanic.locationId, mechanicId: input.mechanic.id },
      update: { locationId: input.mechanic.locationId, mechanicId: input.mechanic.id },
    });
    await tx.diagnosticReview.upsert({ where: { diagnosticRequestId: diagnostic.id }, create: { diagnosticRequestId: diagnostic.id }, update: {} });
    await tx.serviceAppointment.update({
      where: { id: appointment.id },
      data: { status: "DIAGNOSTICS", actualArrivalAt: appointment.actualArrivalAt || new Date(), actualStartAt: appointment.actualStartAt || new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actorId: input.userId,
        actorName: input.mechanic.name,
        entityType: "DiagnosticRequest",
        entityId: diagnostic.id,
        action: "MECHANIC_DIAGNOSTIC_CONTINUED_FROM_SCAN",
        metadata: toPrismaJson({ appointmentId: appointment.id, previousMechanicId: previousAssignment?.mechanicId || null, previousLocationId: previousAssignment?.locationId || null, mechanicId: input.mechanic.id, locationId: input.mechanic.locationId }),
      },
    });
    return diagnostic.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await startStructuredDiagnostic(input.userId, diagnosticRequestId);
  return diagnosticRequestId;
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
  diagnosticRequestId?: string | null;
  vehicleId: string | null;
  workOrderId: string | null;
}) : Promise<NextAction> {
  const prisma = getPrisma();
  const diagnostic = input.diagnosticRequestId
    ? await prisma.diagnosticRequest.findFirst({ where: { id: input.diagnosticRequestId, status: { not: "CANCELLED" } }, select: { id: true, status: true } })
    : input.vehicleId ? await prisma.diagnosticRequest.findFirst({
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
        label: diagnostic.status === "PENDING" ? "Відкрити діагностику" : "Продовжити діагностику",
        diagnosticId: diagnostic.id,
      };
    }
    if (review?.state === "SUBMITTED") {
      return { type: "WAITING", label: "Діагностика завершена", diagnosticId: diagnostic.id, reason: "Очікується перевірка сервіс-менеджера." };
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

  if (!diagnostic) return { type: "WAITING", label: "Очікує підтвердження авто", reason: "Підтвердьте автомобіль скануванням номера — діагностика буде створена автоматично." };
  return { type: "WAITING", label: "Очікує наступного кроку", diagnosticId: diagnostic.id, reason: "Діагностика завершена. Сервіс-менеджер має обрати наступний маршрут." };
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
      select: { id: true, name: true, locationId: true, location: { select: { timezone: true } } },
    });
    if (!mechanic) return NextResponse.json({ ok: false, error: "MECHANIC_NOT_LINKED", message: "Профіль механіка не прив’язаний до станції." }, { status: 403 });

    const contentType = request.headers.get("content-type") || "";
    let rawPlate = "";
    let confidence: number | null = null;
    let confirm = false;
    let continueExisting = false;
    let source = "MANUAL";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const image = form.get("image");
      const manualPlate = clean(form.get("plate"), 32);
      confirm = clean(form.get("confirm"), 8).toLowerCase() === "true";
      continueExisting = clean(form.get("continueExisting"), 8).toLowerCase() === "true";
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
      continueExisting = body.continueExisting === true;
      source = clean(body.source, 32) || "MANUAL";
    }

    const normalized = canonicalPlate(rawPlate);
    if (normalized.length < 5) return NextResponse.json({ ok: false, error: "PLATE_REQUIRED", message: "Не вдалося визначити номер. Спробуйте ще раз або введіть його вручну." }, { status: 400 });

    const window = appointmentWindow(new Date(), mechanic.location.timezone || "Europe/Kyiv");
    const appointments = await prisma.serviceAppointment.findMany({
      where: {
        locationId: mechanic.locationId,
        status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
        plateNumber: { not: null },
        plannedStartAt: { gte: window.from, lt: window.to },
      },
      include: { mechanic: { select: { id: true, name: true } }, post: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "asc" }],
      take: 250,
    });
    const appointment = appointments.find((item) => canonicalPlate(item.plateNumber) === normalized) || null;

    const vehicleSelect = {
      id: true,
      plateNumber: true,
      brand: true,
      model: true,
      year: true,
      mileageKm: true,
      client: { select: { id: true, name: true, phone: true } },
    } as const;

    let vehicle = appointment?.vehicleId ? await prisma.vehicle.findUnique({
      where: { id: appointment.vehicleId },
      select: vehicleSelect,
    }) : null;

    if (!vehicle) {
      const candidates = plateCandidates(rawPlate, normalized);
      vehicle = await prisma.vehicle.findFirst({
        where: {
          OR: [
            { plateNormalized: normalized },
            ...candidates.map((plate) => ({ plateNumber: { equals: plate, mode: "insensitive" as const } })),
          ],
        },
        select: vehicleSelect,
        orderBy: { updatedAt: "desc" },
      });
    }

    const assignedToMe = Boolean(appointment?.mechanicId && appointment.mechanicId === mechanic.id);
    const scenario: ScanScenario = appointment
      ? (assignedToMe ? "ASSIGNED" : "ASSIGNED_TO_OTHER")
      : (vehicle ? "WALK_IN_EXISTING_VEHICLE" : "WALK_IN_NEW_VEHICLE");

    const linkedVisitRows = appointment
      ? await prisma.$queryRaw<Array<{ diagnosticRequestId: string }>>`
          SELECT "diagnosticRequestId" FROM "DiagnosticVisitLink" WHERE "appointmentId" = ${appointment.id} LIMIT 1
        `
      : [];
    const linkedVisit = linkedVisitRows[0] || null;
    const existingAppointmentAction = appointment
      ? await resolveNextAction({
          userId: access.context.user.id,
          mechanicId: mechanic.id,
          diagnosticRequestId: linkedVisit?.diagnosticRequestId || null,
          vehicleId: null,
          workOrderId: appointment.workOrderId || null,
        })
      : null;

    const otherDiagnosticCanStart = Boolean(
      appointment
      && !appointment.workOrderId
      && (!linkedVisit || existingAppointmentAction?.type === "DIAGNOSTIC"),
    );

    let nextAction: NextAction = assignedToMe
      ? await resolveNextAction({
          userId: access.context.user.id,
          mechanicId: mechanic.id,
          vehicleId: vehicle?.id || appointment?.vehicleId || null,
          workOrderId: appointment?.workOrderId || null,
        })
      : !appointment
        ? {
            type: "WAITING",
            label: "Позаплановий заїзд",
            reason: vehicle
              ? "Автомобіль є в базі, але активного запису немає. Можна оформити позапланову діагностику."
              : "Автомобіль не знайдено в базі та активних записах. Можна оформити позапланову діагностику.",
          }
        : {
            type: otherDiagnosticCanStart ? "DIAGNOSTIC" : "NONE",
            label: otherDiagnosticCanStart ? "Продовжити діагностику" : "Авто не закріплене за вами",
            diagnosticId: existingAppointmentAction?.diagnosticId || null,
            reason: appointment?.mechanicId
              ? `Автомобіль призначений іншому механіку${appointment.mechanic?.name ? `: ${appointment.mechanic.name}` : ""}.`
              : "Автомобіль має активний запис, але не призначений вам.",
          };

    let finalAppointmentStatus = appointment?.status || null;
    let arrivalApplied = false;
    let diagnosticRequestId: string | null = nextAction.diagnosticId || null;

    if (confirm) {
      const continuingAssignedOther = Boolean(continueExisting && appointment && scenario === "ASSIGNED_TO_OTHER");
      if ((!assignedToMe && !continuingAssignedOther) || !appointment) {
        return NextResponse.json({ ok: false, error: "VEHICLE_NOT_ASSIGNED", message: "Цей автомобіль не закріплений за вами." }, { status: 403 });
      }

      if (continuingAssignedOther) {
        diagnosticRequestId = await continueAssignedAppointmentDiagnostic({
          userId: access.context.user.id,
          mechanic: { id: mechanic.id, name: mechanic.name, locationId: mechanic.locationId },
          appointmentId: appointment.id,
        });
        finalAppointmentStatus = "DIAGNOSTICS";
        nextAction = { type: "DIAGNOSTIC", label: "Продовжити діагностику", diagnosticId: diagnosticRequestId };
      }

      const shouldApplyArrival = !continuingAssignedOther && (appointment.status === "BOOKED" || appointment.status === "ARRIVED");
      if (shouldApplyArrival) {
        const arrival = await arrivePlannerAppointment(appointment.id, {});
        if (!arrival.ok) {
          const status = "notFound" in arrival && arrival.notFound ? 404 : "workflowBlocked" in arrival && arrival.workflowBlocked ? 409 : 400;
          const message = "arrivalBlocked" in arrival && arrival.arrivalBlocked
            ? arrival.message
            : "Не вдалося підтвердити прибуття автомобіля. Перевірте дані запису.";
          return NextResponse.json({ ok: false, error: "MECHANIC_ARRIVAL_FAILED", message }, { status });
        }

        arrivalApplied = true;
        finalAppointmentStatus = arrival.appointment.status;
        diagnosticRequestId = arrival.workflowAction.diagnosticRequestId || null;
        const arrivalVehicleId = arrival.workflowAction.vehicleId || vehicle?.id || appointment.vehicleId || null;

        if (arrivalVehicleId && arrivalVehicleId !== vehicle?.id) {
          vehicle = await prisma.vehicle.findUnique({
            where: { id: arrivalVehicleId },
            select: vehicleSelect,
          });
        }

        nextAction = await resolveNextAction({
          userId: access.context.user.id,
          mechanicId: mechanic.id,
          vehicleId: arrivalVehicleId,
          workOrderId: appointment.workOrderId || null,
        });
        diagnosticRequestId = nextAction.diagnosticId || diagnosticRequestId;
      }

      if (!continuingAssignedOther && diagnosticRequestId && nextAction.type === "DIAGNOSTIC") {
        await startStructuredDiagnostic(access.context.user.id, diagnosticRequestId);
        nextAction = await resolveNextAction({
          userId: access.context.user.id,
          mechanicId: mechanic.id,
          diagnosticRequestId: linkedVisit?.diagnosticRequestId || null,
          vehicleId: vehicle?.id || appointment.vehicleId || null,
          workOrderId: appointment.workOrderId || null,
        });
        diagnosticRequestId = nextAction.diagnosticId || diagnosticRequestId;
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
            arrivalApplied,
            appointmentStatus: finalAppointmentStatus,
            diagnosticRequestId,
            nextAction: nextAction.type,
            diagnosticAutoStarted: Boolean(diagnosticRequestId && nextAction.type === "DIAGNOSTIC"),
          }),
        },
      }).catch(() => undefined);
    }

    return NextResponse.json({
      ok: true,
      recognized: true,
      scenario,
      recognition: { raw: rawPlate, plate: normalized, confidence, source },
      vehicle: vehicle
        ? { id: vehicle.id, label: vehicleLabel(vehicle), plate: vehicle.plateNumber || normalized, mileageKm: vehicle.mileageKm }
        : { id: null, label: appointment?.vehicleLabel || "Автомобіль", plate: appointment?.plateNumber || normalized, mileageKm: null },
      appointment: appointment
        ? { id: appointment.id, status: finalAppointmentStatus || appointment.status, post: appointment.post?.name || null, plannedStartAt: appointment.plannedStartAt, mechanic: appointment.mechanic?.name || null }
        : null,
      assignedToMe,
      assignment: appointment ? { mechanicId: appointment.mechanicId || null, isAssigned: Boolean(appointment.mechanicId), isMine: assignedToMe } : null,
      walkIn: !appointment ? {
        eligible: true,
        existingVehicle: Boolean(vehicle),
        existingClient: vehicle?.client ? { id: vehicle.client.id, name: vehicle.client.name, phone: vehicle.client.phone } : null,
        mileageKm: vehicle?.mileageKm ?? null,
      } : { eligible: false, existingVehicle: false, existingClient: null, mileageKm: null },
      nextAction,
      confirmed: confirm && (assignedToMe || (continueExisting && scenario === "ASSIGNED_TO_OTHER")),
      arrivalApplied,
      diagnosticRequestId,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "OPENAI_NOT_CONFIGURED") return NextResponse.json({ ok: false, error: code, message: "Розпізнавання фото не налаштоване. Введіть номер вручну." }, { status: 503 });
    if (code === "IMAGE_TOO_LARGE") return NextResponse.json({ ok: false, error: code, message: "Фото завелике. Сфотографуйте номер ближче." }, { status: 413 });
    if (code === "INVALID_IMAGE_TYPE") return NextResponse.json({ ok: false, error: code, message: "Потрібне фото номерного знака." }, { status: 400 });
    if (code === "PLATE_NOT_READABLE" || code === "OPENAI_RECOGNITION_FAILED") return NextResponse.json({ ok: false, error: code, message: "Не вдалося впевнено прочитати номер. Спробуйте ще раз або введіть номер вручну." }, { status: 422 });
    if (code === "AbortError") return NextResponse.json({ ok: false, error: "RECOGNITION_TIMEOUT", message: "Розпізнавання зайняло надто багато часу. Спробуйте ще раз." }, { status: 504 });
    if (error instanceof ScanContinuationError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("POST mechanic vehicle scan failed", error);
    return NextResponse.json({ ok: false, error: "VEHICLE_SCAN_FAILED", message: "Не вдалося перевірити автомобіль." }, { status: 500 });
  }
}
