import { normalizeRegistrationPlate, formatRegistrationPlate } from "@/src/domain/registration-plate";
import { normalizePhone } from "@/src/lib/phone";
import { normalizeVin } from "@/src/domain/vin";

export function identitySearchValues(input: string) {
  const raw = input.trim();
  const phoneDigits = raw.replace(/\D/g, "");
  const phoneValues = new Set<string>();
  if (phoneDigits.length >= 3) {
    phoneValues.add(phoneDigits);
    const canonical = normalizePhone(raw);
    if (canonical) phoneValues.add(canonical);
    if (phoneDigits.startsWith("0")) phoneValues.add(`38${phoneDigits}`);
  }

  const plate = normalizeRegistrationPlate(raw);
  const plateValues = new Set<string>();
  const hasPlateShape = /\d/.test(raw) && plate.length >= 3;
  if (hasPlateShape) {
    plateValues.add(raw);
    plateValues.add(plate);
    const formatted = formatRegistrationPlate(raw);
    if (formatted !== "—") plateValues.add(formatted);
  }

  const vin = normalizeVin(raw);
  return {
    raw,
    phoneValues: [...phoneValues],
    plateValues: [...plateValues],
    plateNormalized: hasPlateShape ? plate : "",
    vin: vin.length >= 3 ? vin : "",
  };
}
