import { DiagnosticRequestStatus, Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { startStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";

const CLOSED_APPOINTMENT_STATUSES = ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] as const;
const WALK_IN_SOURCE = "WALK_IN";
const WALK_IN_MARKER = "WALK_IN_DIAGNOSTIC:";
const CYR_TO_LAT: Record<string, string> = {
  А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
};
const LAT_TO_CYR: Record<string, string> = {
  A: "А", B: "В", E: "Е", I: "І", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", X: "Х", Y: "У",
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

function plateCandidates(raw: string, canonical: string) {
  return Array.from(new Set([raw.toUpperCase().replace(/\s+/g, ""), canonical, cyrillicPlate(canonical)].filter(Boolean)));
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
    select: { id: true, name: true, locationId: true },
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

    const activeAppointments = await tx.serviceAppointment.findMany({
      where: {
        locationId: mechanic.locationId,
        status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
        plateNumber: { not: null },
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

    if (!vehicle) {
      const registry = await tx.vehicleRegistryEntry.findUnique({ where: { plateNormalized: plate } });
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
          vehicleDataSource: registry ? "MVS_OPEN_DATA" : "WALK_IN",
        },
      });
    } else if (vehicle.mileageKm !== mileageKm) {
      vehicle = await tx.vehicle.update({ where: { id: vehicle.id }, data: { mileageKm } });
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
    const plannedEndAt = new Date(now.getTime() + 60 * 60 * 1000);
    const appointment = await tx.serviceAppointment.create({
      data: {
        locationId: mechanic.locationId,
        postId: null,
        mechanicId: mechanic.id,
        leadId: null,
        clientId: client.id,
        vehicleId: vehicle.id,
        workOrderId: null,
        status: "ARRIVED",
        customerName: client.name || clientName,
        phone: phone.display,
        vehicleLabel: vehicleLabel(vehicle),
        plateNumber: plate,
        problem,
        comment: `${WALK_IN_MARKER}${diagnostic.id}`,
        source: WALK_IN_SOURCE,
        priority: 1,
        plannedStartAt: now,
        plannedEndAt,
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
          problem,
          matchedByAdditionalPhone: Boolean(additionalPhone),
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
