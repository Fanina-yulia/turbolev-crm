import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";

export type RegistryVehicleColor = {
  color: string;
  sourceYear: number;
};

export type ResolvedVehicleColor = {
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  exteriorPaintCode: string | null;
  exteriorColorSource: string;
  exteriorColorConfirmed: true;
  sourceYear: number | null;
};

const COLOR_CACHE_TTL_MS = 5 * 60 * 1000;
const resolvedColorCache = new Map<string, { expiresAt: number; value: ResolvedVehicleColor | null }>();
const inFlightColorLookups = new Map<string, Promise<ResolvedVehicleColor | null>>();

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

export async function lookupRegistryVehicleColorByPlate(rawPlate: string | null | undefined): Promise<RegistryVehicleColor | null> {
  const plate = normalizeRegistrationPlate(rawPlate || "");
  const key = registrationPlateKey(plate);
  if (key === null) return null;

  try {
    const result = await getSqlPool().query<{ color: string | null; sourceYear: number }>(
      `SELECT color, "sourceYear"
         FROM public."VehicleRegistryCompact"
        WHERE "plateKey"=$1
          AND color IS NOT NULL
          AND btrim(color) <> ''
        LIMIT 1`,
      [key.toString()],
    );
    const row = result.rows[0];
    const color = row?.color?.trim();
    if (!color) return null;
    return { color: color.slice(0, 120), sourceYear: Number(row.sourceYear) };
  } catch (error) {
    if (error instanceof Error && /column .*color.* does not exist|42703/i.test(error.message)) return null;
    throw error;
  }
}

export async function lookupRegistryVehicleColorByVin(rawVin: string | null | undefined): Promise<RegistryVehicleColor | null> {
  const vin = (rawVin || "").trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;

  try {
    const result = await getSqlPool().query<{ color: string | null; sourceYear: number }>(
      `SELECT color, "sourceYear"
         FROM public."VehicleRegistryCompact"
        WHERE upper(trim(vin))=$1
          AND color IS NOT NULL
          AND btrim(color) <> ''
        ORDER BY "sourceYear" DESC
        LIMIT 1`,
      [vin],
    );
    const row = result.rows[0];
    const color = row?.color?.trim();
    if (!color) return null;
    return { color: color.slice(0, 120), sourceYear: Number(row.sourceYear) };
  } catch (error) {
    if (error instanceof Error && /column .*color.* does not exist|42703/i.test(error.message)) return null;
    throw error;
  }
}

async function resolveVehicleColorUncached(
  rawPlate: string | null | undefined,
  vehicleId?: string | null,
  rawVin?: string | null,
): Promise<ResolvedVehicleColor | null> {
  if (vehicleId) {
    const vehicle = await getPrisma().vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        exteriorColorName: true,
        exteriorColorHex: true,
        exteriorPaintCode: true,
        exteriorColorSource: true,
        exteriorColorConfirmed: true,
      },
    });
    if (vehicle?.exteriorColorConfirmed && (vehicle.exteriorColorName || vehicle.exteriorColorHex || vehicle.exteriorPaintCode)) {
      return {
        exteriorColorName: vehicle.exteriorColorName,
        exteriorColorHex: vehicle.exteriorColorHex,
        exteriorPaintCode: vehicle.exteriorPaintCode,
        exteriorColorSource: vehicle.exteriorColorSource ? String(vehicle.exteriorColorSource) : "USER",
        exteriorColorConfirmed: true,
        sourceYear: null,
      };
    }
  }

  const registry = await lookupRegistryVehicleColorByPlate(rawPlate)
    || await lookupRegistryVehicleColorByVin(rawVin);
  if (!registry) return null;
  return {
    exteriorColorName: registry.color,
    exteriorColorHex: null,
    exteriorPaintCode: null,
    exteriorColorSource: "REGISTRY",
    exteriorColorConfirmed: true,
    sourceYear: registry.sourceYear,
  };
}

export async function resolveVehicleColorByPlate(
  rawPlate: string | null | undefined,
  vehicleId?: string | null,
  rawVin?: string | null,
): Promise<ResolvedVehicleColor | null> {
  const key = [vehicleId || "", normalizeRegistrationPlate(rawPlate || ""), (rawVin || "").trim().toUpperCase()].join("|");
  if (!key.replace(/\|/g, "")) return resolveVehicleColorUncached(rawPlate, vehicleId, rawVin);

  const cached = resolvedColorCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) resolvedColorCache.delete(key);

  const active = inFlightColorLookups.get(key);
  if (active) return active;

  const request = resolveVehicleColorUncached(rawPlate, vehicleId, rawVin)
    .then((value) => {
      resolvedColorCache.set(key, { expiresAt: Date.now() + COLOR_CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => inFlightColorLookups.delete(key));
  inFlightColorLookups.set(key, request);
  return request;
}
