import { LeadStatus, PlannerAppointmentStatus, Prisma } from "@/src/generated/prisma/client";
import { mapUiSourceToLeadSource } from "@/src/domain/workflow/lead";
import { getPrisma } from "@/src/lib/prisma";

export class IntakeValidationError extends Error {}
export class IntakeConflictError extends Error {}

export type IntakePreliminaryWork = {
  id?: string;
  name?: string;
  quantity?: number;
  total?: number;
  manual?: boolean;
};

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
  appointmentDate?: string;
  appointmentTime?: string;
  preliminaryAmount?: string | number;
  preliminaryWorks?: IntakePreliminaryWork[];
  comment?: string;
  locationId?: string;
  postId?: string;
  mechanicId?: string;
  forceReassignVehicle?: boolean;
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

function normalizePreliminaryWorks(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ name:string; quantity:number; total:number; manual:boolean }>;
  return value.slice(0, 40).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = clean(record.name, 240);
    if (!name) return [];
    const quantity = Math.max(1, Math.min(99, toInt(record.quantity) ?? 1));
    const total = Math.max(0, toDecimal(record.total) ?? 0);
    return [{ name, quantity, total, manual: Boolean(record.manual) }];
  });
}

function worksSummary(works: Array<{ name:string; quantity:number; total:number; manual:boolean }>) {
  if (!works.length) return null;
  const lines = works.map((work) => {
    const quantity = work.quantity > 1 ? ` ×${work.quantity}` : "";
    const amount = work.total > 0 ? ` — ${Math.round(work.total)} грн` : "";
    return `• ${work.name}${quantity}${amount}`;
  });
  return `Попередні роботи:\n${lines.join("\n")}`;
}

export async function createIntake(input: IntakeInput) {
  const prisma = getPrisma();
  const phoneNormalized = normalizePhone(input.phone);
  const vin = normalizeVin(input.vin) || null;
  if (vin && vin.length !== 17) throw new IntakeValidationError("VIN повинен містити 17 символів або бути порожнім.");
  const plateNormalized = normalizePlate(input.plate) || null;
  if (!plateNormalized && !vin) throw new IntakeValidationError("Вкажіть державний номер або VIN автомобіля.");

  const appointmentDate = clean(input.appointmentDate, 10);
  const appointmentTime = clean(input.appointmentTime, 8);
  const hasAppointment = Boolean(appointmentDate && appointmentTime);
  const appointmentStart = hasAppointment ? new Date(`${appointmentDate}T${appointmentTime}:00`) : null;
  if (appointmentStart && Number.isNaN(appointmentStart.getTime())) throw new IntakeValidationError("Некоректна дата або час запису.");
  const appointmentEnd = appointmentStart ? new Date(appointmentStart.getTime() + 60 * 60_000) : null;

  const preliminaryWorks = normalizePreliminaryWorks(input.preliminaryWorks);
  const preliminaryWorksText = worksSummary(preliminaryWorks);
  const userComment = clean(input.comment, 5000);
  const combinedComment = [userComment, preliminaryWorksText].filter(Boolean).join("\n\n") || null;

  return prisma.$transaction(async (tx) => {
    const matchingClients = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT c."id"
      FROM "Client" c
      LEFT JOIN "ClientPhone" cp ON cp."clientId" = c."id"
      WHERE c."phoneNormalized" = ${phoneNormalized} OR cp."phoneNormalized" = ${phoneNormalized}
      LIMIT 1
    `);
    let client = matchingClients[0] ? await tx.client.findUnique({ where: { id: matchingClients[0].id } }) : null;
    const inputName = clean(input.customerName, 160);
    if (!client) {
      client = await tx.client.create({ data: { name: inputName, phone: displayPhone(phoneNormalized), phoneNormalized } });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
        VALUES (${`cp_${client.id}_${phoneNormalized}`},${client.id},${displayPhone(phoneNormalized)},${phoneNormalized},'Основний',true,NOW(),NOW())
        ON CONFLICT ("phoneNormalized") DO NOTHING
      `);
    } else {
      const unknownName = inputName?.toLocaleLowerCase("uk-UA").startsWith("невідом");
      if (inputName && !unknownName && inputName !== client.name) {
        client = await tx.client.update({ where: { id: client.id }, data: { name: inputName } });
      }
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
        VALUES (${`cp_${client.id}_${phoneNormalized}`},${client.id},${displayPhone(phoneNormalized)},${phoneNormalized},${client.phoneNormalized === phoneNormalized ? "Основний" : "Додатковий"},${client.phoneNormalized === phoneNormalized},NOW(),NOW())
        ON CONFLICT ("phoneNormalized") DO NOTHING
      `);
    }

    let vehicle = vin ? await tx.vehicle.findUnique({ where: { vin } }) : null;
    if (!vehicle && plateNormalized) vehicle = await tx.vehicle.findUnique({ where: { plateNormalized } });
    const previousClientId = vehicle?.clientId || null;
    const needsReassign = Boolean(vehicle && vehicle.clientId !== client.id);
    if (needsReassign && !input.forceReassignVehicle) {
      throw new IntakeConflictError("Цей VIN або держномер уже прив'язаний до іншого клієнта. Потрібна ручна перевірка.");
    }

    const vehicleData = {
      brand: clean(input.make, 100),
      model: clean(input.model, 120),
      year: toInt(input.year),
      mileageKm: toInt(input.mileage),
      engineName: clean(input.engine, 200),
      engineVolumeCm3: input.engineVolume ? Math.round((Number(String(input.engineVolume).replace(",", ".")) || 0) * 1000) || null : null,
      fuelType: clean(input.fuelType, 80),
      bodyType: clean(input.bodyType, 80),
      grossWeightKg: toInt(input.grossWeight),
      driveType: clean(input.driveType, 80),
      vehicleType: clean(input.vehicleType, 80),
      turboLevClass: clean(input.turboLevClass, 80),
      priceCoefficient: toDecimal(input.priceCoefficient) ?? 1,
      classificationSource: clean(input.classificationSource, 80),
      classificationConfidence: toInt(input.classificationConfidence),
      manualClassOverride: Boolean(input.manualClassOverride),
      vehicleDataSource: clean(input.vehicleDataSource, 100),
      vehicleDataConfidence: toInt(input.vehicleDataConfidence),
      lastVehicleLookupAt: new Date(),
    };

    if (vehicle) {
      vehicle = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          ...vehicleData,
          clientId: needsReassign ? client.id : vehicle.clientId,
          plateNumber: clean(input.plate, 24) || vehicle.plateNumber,
          plateNormalized: plateNormalized || vehicle.plateNormalized,
          vin: vin || vehicle.vin,
        },
      });
    } else {
      vehicle = await tx.vehicle.create({
        data: {
          clientId: client.id,
          ...vehicleData,
          plateNumber: clean(input.plate, 24),
          plateNormalized,
          vin,
        },
      });
    }

    const assignee = clean(input.responsible, 160)
      ? await tx.user.findFirst({ where: { isActive: true, name: { equals: clean(input.responsible, 160)!, mode: "insensitive" } } })
      : null;
    const need = [clean(input.category, 100), clean(input.complaint, 4000)].filter(Boolean).join(" · ") || preliminaryWorks[0]?.name || null;

    let location = null;
    let post = null;
    let mechanic = null;
    if (hasAppointment) {
      const requestedLocationId = clean(input.locationId, 80);
      location = requestedLocationId
        ? await tx.serviceLocation.findFirst({ where: { id: requestedLocationId, isActive: true } })
        : await tx.serviceLocation.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      if (!location) throw new IntakeValidationError("У CRM немає активної локації СТО для запису.");

      const postId = clean(input.postId, 80);
      const mechanicId = clean(input.mechanicId, 80);
      if (!postId) throw new IntakeValidationError("Оберіть пост СТО.");
      if (!mechanicId) throw new IntakeValidationError("Закріпіть майстра.");

      post = await tx.servicePost.findFirst({ where: { id: postId, locationId: location.id, isActive: true } });
      mechanic = await tx.serviceMechanic.findFirst({ where: { id: mechanicId, locationId: location.id, isActive: true } });
      if (!post) throw new IntakeValidationError("Обраний пост недоступний.");
      if (!mechanic) throw new IntakeValidationError("Обраний майстер недоступний.");

      if (appointmentStart && appointmentEnd) {
        const nonBlocking = [PlannerAppointmentStatus.COMPLETED, PlannerAppointmentStatus.NO_SHOW, PlannerAppointmentStatus.CANCELLED];
        const overlap = {
          locationId: location.id,
          status: { notIn: nonBlocking },
          plannedStartAt: { lt: appointmentEnd },
          plannedEndAt: { gt: appointmentStart },
        };
        const postConflict = await tx.serviceAppointment.findFirst({ where: { ...overlap, postId: post.id }, select: { id: true } });
        if (postConflict) throw new IntakeConflictError(`Пост «${post.name}» уже зайнятий у цей час. Оберіть інший пост або час.`);
        const mechanicParallel = await tx.serviceAppointment.count({ where: { ...overlap, mechanicId: mechanic.id } });
        if (mechanicParallel >= 2) throw new IntakeConflictError(`${mechanic.name} уже веде 2 автомобілі одночасно. Оберіть іншого майстра або час.`);
      }
    }

    const lead = await tx.lead.create({
      data: {
        name: client.name || inputName,
        phone: displayPhone(phoneNormalized),
        phoneNormalized,
        status: hasAppointment ? LeadStatus.BOOKED : LeadStatus.NEW,
        source: mapUiSourceToLeadSource(input.source),
        carBrand: vehicle.brand,
        carModel: vehicle.model,
        carYear: vehicle.year,
        plateNumber: vehicle.plateNumber,
        vin: vehicle.vin,
        need,
        comment: combinedComment,
        nextAction: hasAppointment ? "Підтвердити заїзд клієнта" : "Зв'язатися та кваліфікувати звернення",
        preliminaryAmount: toDecimal(input.preliminaryAmount),
        assignedUserId: assignee?.id || null,
        lastActivityAt: new Date(),
      },
    });

    let appointment = null;
    if (appointmentStart && appointmentEnd && location && post && mechanic) {
      appointment = await tx.serviceAppointment.create({
        data: {
          locationId: location.id,
          postId: post.id,
          mechanicId: mechanic.id,
          leadId: lead.id,
          clientId: client.id,
          vehicleId: vehicle.id,
          status: PlannerAppointmentStatus.BOOKED,
          customerName: client.name,
          phone: client.phone,
          vehicleLabel: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.plateNumber || vehicle.vin,
          plateNumber: vehicle.plateNumber,
          problem: need,
          comment: combinedComment,
          source: "CRM_INTAKE",
          estimatedAmount: toDecimal(input.preliminaryAmount),
          plannedStartAt: appointmentStart,
          plannedEndAt: appointmentEnd,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorName: clean(input.responsible, 160) || "CRM",
        entityType: "Lead",
        entityId: lead.id,
        action: "CREATE_FROM_INTAKE",
        after: json(lead),
        metadata: json({ clientId: client.id, vehicleId: vehicle.id, appointmentId: appointment?.id || null, vehicleReassigned: needsReassign, previousClientId, contactPhone: displayPhone(phoneNormalized), preliminaryWorksCount: preliminaryWorks.length, postId: post?.id || null, mechanicId: mechanic?.id || null }),
      },
    });
    if (needsReassign) {
      await tx.auditEvent.create({
        data: {
          actorName: clean(input.responsible, 160) || "CRM",
          entityType: "Vehicle",
          entityId: vehicle.id,
          action: "MANUAL_REASSIGN_FROM_INTAKE",
          metadata: json({ previousClientId, clientId: client.id, plateNumber: vehicle.plateNumber, vin: vehicle.vin }),
        },
      });
    }
    if (appointment) {
      await tx.auditEvent.create({
        data: {
          actorName: clean(input.responsible, 160) || "CRM",
          entityType: "ServiceAppointment",
          entityId: appointment.id,
          action: "CREATE_FROM_INTAKE",
          after: json(appointment),
          metadata: json({ leadId: lead.id, clientId: client.id, vehicleId: vehicle.id, postId: post?.id || null, mechanicId: mechanic?.id || null }),
        },
      });
    }

    return { client, vehicle, lead, appointment, vehicleReassigned: needsReassign, preliminaryWorks };
  });
}
