import "server-only";

import { getSqlPool } from "@/src/lib/sql";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";

export type RegistryVehicleColor = {
  color: string;
  sourceYear: number;
};

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
