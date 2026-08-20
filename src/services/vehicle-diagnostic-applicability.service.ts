import { DiagnosticCheckState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export type DiagnosticFuelKind = "ELECTRIC" | "HYBRID" | "DIESEL" | "PETROL" | "COMBUSTION_OTHER" | "UNKNOWN";
export type DiagnosticDriveKind = "FWD" | "RWD" | "AWD" | "UNKNOWN";

export type VehicleDiagnosticProfile = {
  vehicleId: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  fuelKind: DiagnosticFuelKind;
  driveKind: DiagnosticDriveKind;
  fuelSource: string | null;
  driveSource: string | null;
  isPureElectric: boolean;
  isDiesel: boolean;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("uk-UA").replace(/\s+/g, " ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function fuelKind(value: string): DiagnosticFuelKind {
  if (!value) return "UNKNOWN";
  if (/(plug.?in|phev|hybrid|гібрид|hev\b)/iu.test(value)) return "HYBRID";
  if (/(електро|electric|battery electric|\bbev\b|\bev\b)/iu.test(value)) return "ELECTRIC";
  if (/(diesel|дизел)/iu.test(value)) return "DIESEL";
  if (/(petrol|gasoline|бензин)/iu.test(value)) return "PETROL";
  if (/(lpg|cng|газ)/iu.test(value)) return "COMBUSTION_OTHER";
  return "UNKNOWN";
}

function driveKind(value: string): DiagnosticDriveKind {
  if (!value) return "UNKNOWN";
  if (/(awd|4wd|4x4|повн.*прив)/iu.test(value)) return "AWD";
  if (/(fwd|front.?wheel|передн.*прив)/iu.test(value)) return "FWD";
  if (/(rwd|rear.?wheel|задн.*прив)/iu.test(value)) return "RWD";
  return "UNKNOWN";
}

function knownModelDrive(brand: string | null, model: string | null): DiagnosticDriveKind {
  const key = `${normalized(brand)} ${normalized(model)}`;
  // Поступово розширювана база перевірених конфігурацій. Не вгадуємо привід для невідомих моделей.
  if (/^byd yuan up\b/u.test(key)) return "FWD";
  return "UNKNOWN";
}

export async function getVehicleDiagnosticProfile(diagnosticRequestId: string): Promise<VehicleDiagnosticProfile | null> {
  const prisma = getPrisma();
  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    select: {
      vehicle: {
        select: {
          id: true,
          brand: true,
          model: true,
          year: true,
          vin: true,
          engineName: true,
          fuelType: true,
          driveType: true,
        },
      },
    },
  });
  if (!diagnostic?.vehicle) return null;

  const vehicle = diagnostic.vehicle;
  let vinVehicle: Record<string, unknown> = {};
  if (vehicle.vin && (!vehicle.fuelType || !vehicle.driveType)) {
    const cached = await prisma.vinDecodeCache.findUnique({
      where: { vin: vehicle.vin },
      select: { vehicle: true },
    }).catch(() => null);
    vinVehicle = objectValue(cached?.vehicle);
  }

  const fuelSource = [vehicle.fuelType, vehicle.engineName, vinVehicle.fuelType, vinVehicle.engine]
    .map(normalized)
    .filter(Boolean)
    .join(" ");
  const directDriveSource = [vehicle.driveType, vinVehicle.driveType]
    .map(normalized)
    .filter(Boolean)
    .join(" ");

  const resolvedFuel = fuelKind(fuelSource);
  let resolvedDrive = driveKind(directDriveSource);
  let resolvedDriveSource = directDriveSource || null;
  if (resolvedDrive === "UNKNOWN") {
    resolvedDrive = knownModelDrive(vehicle.brand, vehicle.model);
    if (resolvedDrive !== "UNKNOWN") resolvedDriveSource = "verified-model-rule";
  }

  return {
    vehicleId: vehicle.id,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    fuelKind: resolvedFuel,
    driveKind: resolvedDrive,
    fuelSource: fuelSource || null,
    driveSource: resolvedDriveSource,
    isPureElectric: resolvedFuel === "ELECTRIC",
    isDiesel: resolvedFuel === "DIESEL",
  };
}

export function isDiagnosticItemApplicable(
  profile: VehicleDiagnosticProfile | null,
  sectionCode: string,
  itemCode: string,
) {
  if (!profile) return true;

  if (sectionCode === "FRONT_DRIVE" || sectionCode === "AXLE_SEALS_FRONT") {
    return profile.driveKind !== "RWD";
  }
  if (sectionCode === "AXLE_SEALS_REAR") {
    return profile.driveKind !== "FWD";
  }

  if (sectionCode === "ENGINE_LEAKS") return !profile.isPureElectric;
  if (sectionCode === "EXHAUST") {
    if (profile.isPureElectric) return false;
    if (itemCode === "DPF") return profile.isDiesel;
    return true;
  }

  if (sectionCode === "TRANSMISSION_LEAKS" && profile.isPureElectric) {
    return itemCode === "GEARBOX_BODY_LEAK";
  }

  if (sectionCode === "FLUIDS_EXTENDED") {
    if (profile.isPureElectric && (itemCode.startsWith("ENGINE_OIL_") || itemCode.startsWith("POWER_STEERING_"))) return false;
    return true;
  }

  return true;
}

/**
 * При уточненні конфігурації авто прибираємо тільки ще не заповнені пункти,
 * які конструктивно не стосуються цього автомобіля. Вже внесені результати не знищуємо.
 */
export async function removeUnapplicableUncheckedChecks(diagnosticRequestId: string, profile?: VehicleDiagnosticProfile | null) {
  const prisma = getPrisma();
  const resolvedProfile = profile === undefined ? await getVehicleDiagnosticProfile(diagnosticRequestId) : profile;
  if (!resolvedProfile) return { removed: 0 };

  const inspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { id: true },
  });
  if (!inspections.length) return { removed: 0 };

  const checks = await prisma.diagnosticCheck.findMany({
    where: {
      inspectionId: { in: inspections.map((item) => item.id) },
      state: DiagnosticCheckState.NOT_CHECKED,
    },
    select: { id: true, templateItemId: true },
  });
  if (!checks.length) return { removed: 0 };

  const items = await prisma.diagnosticTemplateItem.findMany({
    where: { id: { in: Array.from(new Set(checks.map((item) => item.templateItemId))) } },
    select: { id: true, code: true, sectionId: true },
  });
  const sections = await prisma.diagnosticTemplateSection.findMany({
    where: { id: { in: Array.from(new Set(items.map((item) => item.sectionId))) } },
    select: { id: true, code: true },
  });
  const sectionCodeById = new Map(sections.map((section) => [section.id, section.code]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  const removeIds = checks.flatMap((check) => {
    const item = itemById.get(check.templateItemId);
    if (!item) return [];
    const sectionCode = sectionCodeById.get(item.sectionId);
    if (!sectionCode) return [];
    return isDiagnosticItemApplicable(resolvedProfile, sectionCode, item.code) ? [] : [check.id];
  });

  if (!removeIds.length) return { removed: 0 };
  const result = await prisma.diagnosticCheck.deleteMany({ where: { id: { in: removeIds } } });
  return { removed: result.count };
}
