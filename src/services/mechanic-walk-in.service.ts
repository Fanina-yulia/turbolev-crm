import { DiagnosticRequestStatus, Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { linkDiagnosticVisit } from "@/src/services/diagnostic-visit-link.service";
import { addDateKey, minuteLabel, zonedDateKey, zonedDateTimeToDate } from "@/src/lib/zoned-time";
import { normalizePlannerSchedule } from "@/src/services/planner-availability.service";
import { PLANNER_BLOCKING_STATUSES } from "@/src/services/planner.service";
import { startStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";

const CLOSED_APPOINTMENT_STATUSES = ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] as const;
const WALK_IN_SOURCE = "WALK_IN";
const WALK_IN_MARKER = "WALK_IN_DIAGNOSTIC:";
const WALK_IN_DURATION_MINUTES = 60;
const CYR_TO_LAT: Record<string, string> = {
  А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
};
const LAT_TO_CYR: Record<string, string> = {
  A: "А", B: "В", E: "Е", I: "І", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", X: "Х", Y: "У",
};

type WalkInRegistryVehicle = {
  vin: string | null;
  brand: string | null;
  model: string | null;
  makeYear: number | null;
  engineVolumeCm3: number | null;
  fuelType: string | null;
  bodyType: string | null;
  grossWeightKg: number | null;
  exteriorColorName: string | null;
  source: "MVS_INDEX" | "MVS_OPEN_DATA";
};

export class MechanicWalkInError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "MechanicWalkInError";
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function canonicalWalkInPlate(value: unknown) {
  const source = clean(value, 32).normalize("NFKC").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
  return [...source].map((char) => CYR_TO_LAT[char] || char).join("");
}

function cyrillicPlate(value: string) {
  return [...value].map((char) => LAT_TO_CYR[char] || char).join("");
}

function normalizePhone(value: unknown) {
  let digits = clean(value, 40).replace(/\D+/g, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = `38${digits}`;
  if (digits.length === 11 && digits.startsWith("80")) digits = `3${digits}`;
  if (digits.length !== 12 || !digits.startsWith("380")) {
    throw new MechanicWalkInError("PHONE_INVALID", "Введіть коректний український номер телефону у форматі +380XXXXXXXXX.");
  }
  return { normalized: digits, display: `+${digits}` };
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function diagnosticIdFromWalkInComment(comment: string | null | undefined) {
  const match = comment?.match(/WALK_IN_DIAGNOSTIC:([^\s]+)/);
  return match?.[1] || null;
}

function overlaps(start: Date, end: Date, otherStart: Date, otherEnd: Date) {
  return start < otherEnd && end > otherStart;
}

function weekdayForDateKey(dateKey: string) {
  const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function activeAppointmentWindow(now: Date, timezone: string) {
  const centerDay = zonedDateKey(now, timezone);
  return {
    from: zonedDateTimeToDate(addDateKey(centerDay, -5), "00:00", timezone),
    to: zonedDateTimeToDate(addDateKey(centerDay, 6), "00:00", timezone),
  };
}

async function findNearestWalkInSlot(tx: Prisma.TransactionClient, locationId: string, from: Date) {
  const [location, scheduleSetting] = await Promise.all([
    tx.serviceLocation.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        timezone: true,
        openMinute: true,
        closeMinute: true,
        posts: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } },
      },
    }),
    tx.crmSetting.findUnique({ where: { key: "work_schedule" }, select: { value: true } }),
  ]);
  if (!location) throw new MechanicWalkInError("LOCATION_NOT_FOUND", "Локацію СТО не знайдено.", 404);

  const timezone = location.timezone || "Europe/Kyiv";
  const schedule = normalizePlannerSchedule(scheduleSetting?.value, location.openMinute, location.closeMinute);
  const searchUntil = new Date(from.getTime() + 31 * 24 * 60 * 60 * 1000);
  const appointments = await tx.serviceAppointment.findMany({
    where: {
      locationId,
      status: { in: [...PLANNER_BLOCKING_STATUSES] },
      plannedStartAt: { lt: searchUntil },
      plannedEndAt: { gt: from },
    },
    select: { postId: true, plannedStartAt: true, plannedEndAt: true },
  });

  const nowParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(from).map((part) => [part.type, part.value]));
  const currentMinute = Number(nowParts.hour) * 60 + Number(nowParts.minute);
  let dayKey = zonedDateKey(from, timezone);

  for (let dayOffset = 0; dayOffset < 31; dayOffset += 1) {
    if (dayOffset > 0) dayKey = addDateKey(dayKey, 1);
    const daySchedule = schedule.find((item) => item.day === weekdayForDateKey(dayKey));
    if (!daySchedule?.enabled) continue;
    const firstMinute = dayOffset === 0
      ? Math.max(daySchedule.openMinute, Math.ceil(currentMinute / 30) * 30)
      : daySchedule.openMinute;

    for (let minute = firstMinute; minute + WALK_IN_DURATION_MINUTES <= daySchedule.closeMinute; minute += 30) {
      const start = zonedDateTimeToDate(dayKey, minuteLabel(minute), timezone);
      const end = new Date(start.getTime() + WALK_IN_DURATION_MINUTES * 60_000);
      if (start < from) continue;
      const overlapping = appointments.filter((item) => overlaps(start, end, item.plannedStartAt, item.plannedEndAt));
      const post = location.posts.find((candidate) => !overlapping.some((item) => item.postId === candidate.id));
      if (location.posts.length > 0 && !post) continue;
      return { start, end, postId: post?.id || null };
    }
  }

  throw new MechanicWalkInError("NO_AVAILABLE_SLOT", "Не знайдено доступного слота для діагностики у робочому графіку СТО.", 409);
}

function plateCandidates(raw: string, canonical: string) {
  return Array.from(new Set([raw.toUpperCase().replace(/\s+/g, ""), canonical, cyrillicPlate(canonical)].filter(Boolean)));
}

function registrationPlateKey(plate: string): bigint | null {
  if (!/^[A-Z0-9]{6,10}$/.test(plate)) return null;
  let value = 0n;
  for (const char of plate) {
    const code = char.charCodeAt(0);
    const digit = code >= 48 && code <= 57 ? code - 48 : code - 65 + 10;
    if (digit < 0 || digit >= 36) return null;
    value = value * 36n + BigInt(digit);
  }
  return value * 16n + BigInt(plate.length);
}

async function findWalkInRegistryVehicle(tx: Prisma.TransactionClient, plate: string): Promise<WalkInRegistryVehicle | null> {
  const plateKey = registrationPlateKey(plate);
  if (plateKey !== null) {
    const rows = await tx.$queryRaw<Array<{
      vin: string | null;
      brand: string | null;
      model: string | null;
      makeYear: number | null;
      engineVolumeCm3: number | null;
      fuelType: string | null;
      vehicleTypeRaw: string | null;
      color: string | null;
    }>>`
      SELECT vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "vehicleTypeRaw", color
      FROM "VehicleRegistryCompact"
      WHERE "plateKey" = ${plateKey}
      LIMIT 1
    `;
    const compact = rows[0];
    if (compact) {
      return {
        vin: compact.vin,
        brand: compact.brand,
        model: compact.model,
        makeYear: compact.makeYear,
        engineVolumeCm3: compact.engineVolumeCm3,
        fuelType: compact.fuelType,
        bodyType: compact.vehicleTypeRaw,
        grossWeightKg: null,
        exteriorColorName: compact.color,
        source: "MVS_INDEX",
      };
    }
  }

  const legacy = await tx.vehicleRegistryEntry.findUnique({ where: { plateNormalized: plate } });
  if (!legacy) return null;
  return {
    vin: legacy.vin,
    brand: legacy.brand,
    model: legacy.model,
    makeYear: legacy.makeYear,
    engineVolumeCm3: legacy.engineVolumeCm3,
    fuelType: legacy.fuelType,
    bodyType: legacy.bodyType ?? legacy.vehicleKind,
    grossWeightKg: legacy.grossWeightKg,
    exteriorColorName: null,
    source: "MVS_OPEN_DATA",
  };
}

export type MechanicWalkInInput = {
  plate?: unknown;
  phone?: unknown;
  clientName?: unknown;
  mileageKm?: unknown;
  problem?: unknown;
};

export async function startMechanicWalkInDiagnostic(userId: string, input: MechanicWalkInInput) {
  const prisma = getPrisma();
  const mechanic = await prisma.serviceMechanic.findFirst({
    where: { userId, isActive: true },
    select: { id: true, name: true, locationId: true, location: { select: { timezone: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!mechanic) throw new MechanicWalkInError("MECHANIC_NOT_LINKED", "Профіль механіка не прив’язаний до станції.", 403);

  const rawPlate = clean(input.plate, 32);
  const plate = canonicalWalkInPlate(rawPlate);
  if (plate.length < 5) throw new MechanicWalkInError("PLATE_REQUIRED", "Не вдалося визначити номер автомобіля.");

  const phone = normalizePhone(input.phone);
  const clientName = clean(input.clientName, 120);
  if (clientName.length < 2) throw new MechanicWalkInError("CLIENT_NAME_REQUIRED", "Вкажіть ім’я та прізвище клієнта.");

  const mileageKm = Number(input.mileageKm);
  if (!Number.isInteger(mileageKm) || mileageKm <= 0 || mileageKm > 2_000_000) {
    throw new MechanicWalkInError("MILEAGE_INVALID", "Вкажіть коректний пробіг автомобіля.");
  }
  const problem = clean(input.problem, 1000) || "Позапланова діагностика";
  const candidates = plateCandidates(rawPlate, plate);

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mechanic-walk-in:${mechanic.locationId}:${plate}`}))`;

    const window = activeAppointmentWindow(new Date(), mechanic.location.timezone || "Europe/Kyiv");
    const activeAppointments = await tx.serviceAppointment.findMany({
      where: {
        locationId: mechanic.locationId,
        status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
        plateNumber: { not: null },
        plannedStartAt: { gte: window.from, lt: window.to },
      },
      orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }],
      take: 250,
    });
    const existingAppointment = activeAppointments.find((row) => canonicalWalkInPlate(row.plateNumber) === plate) || null;

    if (existingAppointment) {
      if (existingAppointment.source !== WALK_IN_SOURCE) {
        throw new MechanicWalkInError(
          "ACTIVE_APPOINTMENT_EXISTS",
          existingAppointment.mechanicId && existingAppointment.mechanicId !== mechanic.id
            ? "Автомобіль уже має активний запис і закріплений за іншим механіком."
            : "Автомобіль уже має активний запис. Використайте звичайне підтвердження заїзду.",
          409,
        );
      }
      if (existingAppointment.mechanicId && existingAppointment.mechanicId !== mechanic.id) {
        throw new MechanicWalkInError("WALK_IN_ASSIGNED_TO_OTHER", "Позаплановий заїзд уже закріплений за іншим механіком.", 409);
      }
      const existingDiagnosticId = diagnosticIdFromWalkInComment(existingAppointment.comment);
      if (existingDiagnosticId) {
        const diagnostic = await tx.diagnosticRequest.findUnique({ where: { id: existingDiagnosticId } });
        if (diagnostic && diagnostic.status !== DiagnosticRequestStatus.CANCELLED) {
          return {
            reused: true,
            clientId: existingAppointment.clientId!,
            vehicleId: existingAppointment.vehicleId!,
            appointmentId: existingAppointment.id,
            diagnosticRequestId: diagnostic.id,
          };
        }
      }
    }

    const primaryClient = await tx.client.findUnique({ where: { phoneNormalized: phone.normalized } });
    const additionalPhone = primaryClient
      ? null
      : await tx.clientPhone.findUnique({
          where: { phoneNormalized: phone.normalized },
          include: { client: true },
        });
    const client = primaryClient
      ?? additionalPhone?.client
      ?? await tx.client.create({ data: { name: clientName, phone: phone.display, phoneNormalized: phone.normalized } });

    let vehicle = await tx.vehicle.findFirst({
      where: {
        OR: [
          { plateNormalized: plate },
          ...candidates.map((candidate) => ({ plateNumber: { equals: candidate, mode: "insensitive" as const } })),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });

    if (vehicle && vehicle.clientId !== client.id) {
      throw new MechanicWalkInError(
        "VEHICLE_CLIENT_MISMATCH",
        "Цей держномер уже прив’язаний до іншого клієнта. Потрібна перевірка сервіс-менеджера.",
        409,
      );
    }

    const registry = await findWalkInRegistryVehicle(tx, plate);

    if (!vehicle) {
      vehicle = await tx.vehicle.create({
        data: {
          clientId: client.id,
          plateNumber: plate,
          plateNormalized: plate,
          mileageKm,
          brand: registry?.brand || null,
          model: registry?.model || null,
          year: registry?.makeYear || null,
          vin: registry?.vin || null,
          engineVolumeCm3: registry?.engineVolumeCm3 || null,
          fuelType: registry?.fuelType || null,
          bodyType: registry?.bodyType || null,
          grossWeightKg: registry?.grossWeightKg || null,
          exteriorColorName: registry?.exteriorColorName || null,
          vehicleDataSource: registry?.source || "WALK_IN",
          vehicleDataConfidence: registry ? (registry.vin ? 96 : 90) : null,
        },
      });
    } else {
      const data: Prisma.VehicleUpdateInput = { mileageKm };
      if (registry) {
        if (!vehicle.brand && registry.brand) data.brand = registry.brand;
        if (!vehicle.model && registry.model) data.model = registry.model;
        if (!vehicle.year && registry.makeYear) data.year = registry.makeYear;
        if (!vehicle.vin && registry.vin) data.vin = registry.vin;
        if (!vehicle.engineVolumeCm3 && registry.engineVolumeCm3) data.engineVolumeCm3 = registry.engineVolumeCm3;
        if (!vehicle.fuelType && registry.fuelType) data.fuelType = registry.fuelType;
        if (!vehicle.bodyType && registry.bodyType) data.bodyType = registry.bodyType;
        if (!vehicle.grossWeightKg && registry.grossWeightKg) data.grossWeightKg = registry.grossWeightKg;
        if (!vehicle.exteriorColorName && registry.exteriorColorName) data.exteriorColorName = registry.exteriorColorName;
        if (!vehicle.vehicleDataSource || vehicle.vehicleDataSource === WALK_IN_SOURCE) data.vehicleDataSource = registry.source;
        if (!vehicle.vehicleDataConfidence) data.vehicleDataConfidence = registry.vin ? 96 : 90;
      }
      vehicle = await tx.vehicle.update({ where: { id: vehicle.id }, data });
    }

    const registration = await tx.vehicleRegistration.findFirst({
      where: { vehicleId: vehicle.id, isCurrent: true, plateNormalized: plate },
      select: { id: true },
    });
    if (!registration) {
      await tx.vehicleRegistration.create({
        data: { vehicleId: vehicle.id, countryCode: "UA", plateNumber: plate, plateNormalized: plate, source: WALK_IN_SOURCE, isCurrent: true, validFrom: new Date() },
      });
    }

    const diagnostic = await tx.diagnosticRequest.create({
      data: { clientId: client.id, vehicleId: vehicle.id, status: DiagnosticRequestStatus.PENDING },
    });
    await tx.diagnosticAssignment.create({
      data: { diagnosticRequestId: diagnostic.id, locationId: mechanic.locationId, mechanicId: mechanic.id },
    });
    await tx.diagnosticReview.create({ data: { diagnosticRequestId: diagnostic.id } });

    const now = new Date();
    const slot = await findNearestWalkInSlot(tx, mechanic.locationId, now);
    const appointment = await tx.serviceAppointment.create({
      data: {
        locationId: mechanic.locationId,
        postId: slot.postId,
        mechanicId: mechanic.id,
        leadId: null,
        clientId: client.id,
        vehicleId: vehicle.id,
        workOrderId: null,
        purpose: "DIAGNOSTICS",
        status: "ARRIVED",
        customerName: client.name || clientName,
        phone: phone.display,
        vehicleLabel: vehicleLabel(vehicle),
        plateNumber: plate,
        problem,
        comment: `${WALK_IN_MARKER}${diagnostic.id}`,
        source: WALK_IN_SOURCE,
        priority: 1,
        plannedStartAt: slot.start,
        plannedEndAt: slot.end,
        actualArrivalAt: now,
        createdById: userId,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: userId,
        actorName: mechanic.name,
        entityType: "ServiceAppointment",
        entityId: appointment.id,
        action: "MECHANIC_WALK_IN_CREATED",
        metadata: toPrismaJson({
          source: WALK_IN_SOURCE,
          plate,
          mileageKm,
          clientId: client.id,
          vehicleId: vehicle.id,
          diagnosticRequestId: diagnostic.id,
          mechanicId: mechanic.id,
          locationId: mechanic.locationId,
          plannedStartAt: slot.start,
          plannedEndAt: slot.end,
          postId: slot.postId,
          problem,
          matchedByAdditionalPhone: Boolean(additionalPhone),
          registrySource: registry?.source || null,
        }),
      },
    });

    return {
      reused: false,
      clientId: client.id,
      vehicleId: vehicle.id,
      appointmentId: appointment.id,
      diagnosticRequestId: diagnostic.id,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await linkDiagnosticVisit({
    diagnosticRequestId: created.diagnosticRequestId,
    appointmentId: created.appointmentId,
    vehicleId: created.vehicleId,
    source: "WALK_IN",
  });
  await startStructuredDiagnostic(userId, created.diagnosticRequestId);
  await prisma.serviceAppointment.updateMany({
    where: { id: created.appointmentId, source: WALK_IN_SOURCE, status: { in: ["ARRIVED", "DIAGNOSTICS"] } },
    data: { status: "DIAGNOSTICS", actualStartAt: new Date() },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: userId,
      actorName: mechanic.name,
      entityType: "DiagnosticRequest",
      entityId: created.diagnosticRequestId,
      action: "WALK_IN_DIAGNOSTIC_STARTED",
      metadata: toPrismaJson({ appointmentId: created.appointmentId, reused: created.reused }),
    },
  }).catch(() => undefined);

  return { ...created, diagnosticStarted: true, walkIn: true };
}
