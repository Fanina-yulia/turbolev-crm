import { getPrisma } from "@/src/lib/prisma";

export type VehicleConfigurationOption = {
  id: string;
  generation: string | null;
  modification: string | null;
  engine: string | null;
  engineVolume: string | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  transmission: string | null;
  source: string;
  confidence: number;
};

type VinCacheRow = {
  vehicle: unknown;
  confidence: number;
  source: string;
};

type VehicleRow = {
  engineName: string | null;
  engineVolumeCm3: number | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  vehicleDataSource: string | null;
  vehicleDataConfidence: number | null;
};

function text(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized || null;
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function volumeLiters(value: unknown) {
  const parsed = numberValue(value);
  if (!parsed) return null;
  return String(Math.round(parsed * 1000) / 1000).replace(/\.0+$/, "");
}

function volumeFromCm3(value: unknown) {
  const parsed = numberValue(value);
  if (!parsed) return null;
  return String(Math.round((parsed / 1000) * 100) / 100).replace(/\.0+$/, "");
}

function clampConfidence(value: unknown, fallback = 70) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function vehicleJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function configurationKey(item: Omit<VehicleConfigurationOption, "id">) {
  return [item.generation, item.modification, item.engine, item.engineVolume, item.fuelType, item.driveType, item.transmission]
    .map((value) => (value ?? "").trim().toLocaleLowerCase("uk-UA"))
    .join("|");
}

export async function listVehicleConfigurations(input: { make: string; model: string; year: number }) {
  const make = input.make.trim();
  const model = input.model.trim();
  const year = Number(input.year);

  if (!make || !model || !Number.isInteger(year) || year < 1900 || year > 2100) {
    return { items: [] as VehicleConfigurationOption[], source: "INVALID_FILTER", total: 0 };
  }

  try {
    const prisma = getPrisma();
    const [vinRows, vehicleRows] = await Promise.all([
      prisma.$queryRawUnsafe<VinCacheRow[]>(
        `SELECT "vehicle", "confidence", "source"
         FROM "VinDecodeCache"
         WHERE lower(coalesce("vehicle"->>'make', '')) = lower($1)
           AND lower(coalesce("vehicle"->>'model', '')) = lower($2)
           AND CASE WHEN coalesce("vehicle"->>'year', '') ~ '^[0-9]{4}$' THEN ("vehicle"->>'year')::int END = $3
         ORDER BY "updatedAt" DESC
         LIMIT 200`,
        make,
        model,
        year,
      ),
      prisma.$queryRawUnsafe<VehicleRow[]>(
        `SELECT "engineName", "engineVolumeCm3", "fuelType", "bodyType", "driveType", "vehicleDataSource", "vehicleDataConfidence"
         FROM "Vehicle"
         WHERE lower(coalesce("brand", '')) = lower($1)
           AND lower(coalesce("model", '')) = lower($2)
           AND "year" = $3
         ORDER BY "updatedAt" DESC
         LIMIT 200`,
        make,
        model,
        year,
      ),
    ]);

    const candidates: Omit<VehicleConfigurationOption, "id">[] = [];

    for (const row of vinRows) {
      const vehicle = vehicleJson(row.vehicle);
      candidates.push({
        generation: text(vehicle.series),
        modification: text(vehicle.trim),
        engine: text(vehicle.engine),
        engineVolume: volumeLiters(vehicle.engineVolumeL),
        fuelType: text(vehicle.fuelType),
        bodyType: text(vehicle.bodyType),
        driveType: text(vehicle.driveType),
        transmission: text(vehicle.transmission),
        source: row.source || "VIN_CACHE",
        confidence: clampConfidence(row.confidence, 80),
      });
    }

    for (const row of vehicleRows) {
      candidates.push({
        generation: null,
        modification: null,
        engine: text(row.engineName),
        engineVolume: volumeFromCm3(row.engineVolumeCm3),
        fuelType: text(row.fuelType),
        bodyType: text(row.bodyType),
        driveType: text(row.driveType),
        transmission: null,
        source: row.vehicleDataSource || "TURBO_LEV_CRM",
        confidence: clampConfidence(row.vehicleDataConfidence, 100),
      });
    }

    const unique = new Map<string, Omit<VehicleConfigurationOption, "id">>();
    for (const candidate of candidates) {
      if (!candidate.generation && !candidate.modification && !candidate.engine && !candidate.engineVolume && !candidate.fuelType) continue;
      const key = configurationKey(candidate);
      const previous = unique.get(key);
      if (!previous || candidate.confidence > previous.confidence) unique.set(key, candidate);
    }

    const items = [...unique.values()]
      .sort((a, b) => {
        const left = [a.generation, a.modification, a.engine, a.engineVolume].filter(Boolean).join(" ");
        const right = [b.generation, b.modification, b.engine, b.engineVolume].filter(Boolean).join(" ");
        return left.localeCompare(right, "uk-UA");
      })
      .map((item, index) => ({ ...item, id: `cfg-${index + 1}` }));

    return {
      items,
      source: items.length ? "TURBO_LEV_KNOWLEDGE_BASE" : "EMPTY",
      total: items.length,
      coverage: { vinCache: vinRows.length, crmVehicles: vehicleRows.length },
    };
  } catch (error) {
    console.warn("Vehicle configuration catalog unavailable", error);
    return { items: [] as VehicleConfigurationOption[], source: "UNAVAILABLE", total: 0 };
  }
}
