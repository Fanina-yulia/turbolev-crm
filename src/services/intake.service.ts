import { LeadStatus, Prisma } from "@/src/generated/prisma/client";
import { mapUiSourceToLeadSource } from "@/src/domain/workflow/lead";
import { getPrisma } from "@/src/lib/prisma";

export class IntakeValidationError extends Error {}
export class IntakeConflictError extends Error {}

export type IntakeInput = {
  customerName?: string;
  phone: string;
  source?: string;
  responsible?: string;
  plate?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: string | number;
  mileage?: string | number;
  engine?: string;
  engineVolume?: string | number;
  fuelType?: string;
  bodyType?: string;
  grossWeight?: string | number;
  driveType?: string;
  vehicleType?: string;
  turboLevClass?: string;
  priceCoefficient?: string | number;
  classificationSource?: string;
  classificationConfidence?: string | number;
  manualClassOverride?: boolean;
  vehicleDataSource?: string;
  vehicleDataConfidence?: string | number;
  category?: string;
  complaint?: string;
  urgency?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  preliminaryAmount?: string | number;
  comment?: string;
};

function clean(value: unknown, max = 1000) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
function digits(value: unknown) { return String(value || "").replace(/\D/g, ""); }
function normalizePhone(value: unknown) {
  let d = digits(value);
  if (d.startsWith("0")) d = `38${d}`;
  if (!d.startsWith("380") && d.length === 9) d = `380${d}`;
  if (d.length !== 12 || !d.startsWith("380")) throw new IntakeValidationError("Вкажіть коректний український номер телефону.");
  return d;
}
function displayPhone(normalized: string) { return `+${normalized}`; }
function normalizeVin(value: unknown) { return String(value || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17); }
function normalizePlate(value: unknown) { return String(value || "").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/gi, "").slice(0, 24); }
function toInt(value: unknown) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) ? Math.round(n) : null; }
function toDecimal(value: unknown) { if (value === null || value === undefined || value === "") return null; const n = Number(String(value).replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : null; }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

export async function createIntake(input: IntakeInput) {
  const prisma = getPrisma();
  const phoneNormalized = normalizePhone(input.phone);
  const vin = normalizeVin(input.vin) || null;
  if (vin && vin.length !== 17) throw new IntakeValidationError("VIN повинен містити 17 символів або бути порожнім.");
  const plateNormalized = normalizePlate(input.plate) || null;
  const hasAppointment = Boolean(clean(input.appointmentDate, 10) && clean(input.appointmentTime, 8));
  const appointmentStart = hasAppointment ? new Date(`${input.appointmentDate}T${input.appointmentTime}:00`) : null;
  if (appointmentStart && Number.isNaN(appointmentStart.getTime())) throw new IntakeValidationError("Некоректна дата або час запису.");
  const appointmentEnd = appointmentStart ? new Date(appointmentStart.getTime() + 60 * 60_000) : null;

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.upsert({
      where: { phoneNormalized },
      create: { name: clean(input.customerName, 160), phone: displayPhone(phoneNormalized), phoneNormalized },
      update: { name: clean(input.customerName, 160) || undefined, phone: displayPhone(phoneNormalized) },
    });

    let vehicle = vin ? await tx.vehicle.findUnique({ where: { vin } }) : null;
    if (!vehicle && plateNormalized) vehicle = await tx.vehicle.findUnique({ where: { plateNormalized } });
    if (vehicle && vehicle.clientId !== client.id) throw new IntakeConflictError("Цей VIN або держномер уже прив'язаний до іншого клієнта. Потрібна ручна перевірка.");

    const vehicleData = {
      brand: clean(input.make, 100), model: clean(input.model, 120), year: toInt(input.year), mileageKm: toInt(input.mileage),
      engineName: clean(input.engine, 200), engineVolumeCm3: input.engineVolume ? Math.round((Number(String(input.engineVolume).replace(",", ".")) || 0) * 1000) || null : null,
      fuelType: clean(input.fuelType, 80), bodyType: clean(input.bodyType, 80), grossWeightKg: toInt(input.grossWeight), driveType: clean(input.driveType, 80),
      vehicleType: clean(input.vehicleType, 80), turboLevClass: clean(input.turboLevClass, 80), priceCoefficient: toDecimal(input.priceCoefficient) ?? 1,
      classificationSource: clean(input.classificationSource, 80), classificationConfidence: toInt(input.classificationConfidence), manualClassOverride: Boolean(input.manualClassOverride),
      vehicleDataSource: clean(input.vehicleDataSource, 100), vehicleDataConfidence: toInt(input.vehicleDataConfidence), lastVehicleLookupAt: new Date(),
    };

    if (vehicle) {
      vehicle = await tx.vehicle.update({ where: { id: vehicle.id }, data: { ...vehicleData, plateNumber: clean(input.plate, 24) || vehicle.plateNumber, plateNormalized: plateNormalized || vehicle.plateNormalized, vin: vin || vehicle.vin } });
    } else {
      vehicle = await tx.vehicle.create({ data: { clientId: client.id, ...vehicleData, plateNumber: clean(input.plate, 24), plateNormalized, vin } });
    }

    const assignee = clean(input.responsible, 160) ? await tx.user.findFirst({ where: { isActive: true, name: { equals: clean(input.responsible, 160)!, mode: "insensitive" } } }) : null;
    const need = [clean(input.category, 100), clean(input.complaint, 4000)].filter(Boolean).join(" · ") || null;
    const lead = await tx.lead.create({
      data: {
        name: clean(input.customerName, 160), phone: displayPhone(phoneNormalized), phoneNormalized,
        status: hasAppointment ? LeadStatus.BOOKED : LeadStatus.NEW, source: mapUiSourceToLeadSource(input.source),
        carBrand: vehicle.brand, carModel: vehicle.model, carYear: vehicle.year, plateNumber: vehicle.plateNumber, vin: vehicle.vin,
        need, comment: clean(input.comment, 5000), nextAction: hasAppointment ? "Підтвердити заїзд клієнта" : "Зв'язатися та кваліфікувати звернення",
        preliminaryAmount: toDecimal(input.preliminaryAmount), assignedUserId: assignee?.id || null, lastActivityAt: new Date(),
      },
    });

    let appointment = null;
    if (appointmentStart && appointmentEnd) {
      const location = await tx.serviceLocation.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      if (!location) throw new IntakeValidationError("У CRM немає активної локації СТО для запису.");
      appointment = await tx.serviceAppointment.create({
        data: {
          locationId: location.id, leadId: lead.id, clientId: client.id, vehicleId: vehicle.id, status: "BOOKED",
          customerName: client.name, phone: client.phone, vehicleLabel: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" "),
          plateNumber: vehicle.plateNumber, problem: need, comment: clean(input.comment, 5000), source: "CRM_INTAKE",
          estimatedAmount: toDecimal(input.preliminaryAmount), plannedStartAt: appointmentStart, plannedEndAt: appointmentEnd,
        },
      });
    }

    await tx.auditEvent.create({ data: { actorName: clean(input.responsible, 160) || "CRM", entityType: "Lead", entityId: lead.id, action: "CREATE_FROM_INTAKE", after: json(lead), metadata: json({ clientId: client.id, vehicleId: vehicle.id, appointmentId: appointment?.id || null }) } });
    if (appointment) await tx.auditEvent.create({ data: { actorName: clean(input.responsible, 160) || "CRM", entityType: "ServiceAppointment", entityId: appointment.id, action: "CREATE_FROM_INTAKE", after: json(appointment), metadata: json({ leadId: lead.id, clientId: client.id, vehicleId: vehicle.id }) } });

    return { client, vehicle, lead, appointment };
  });
}
