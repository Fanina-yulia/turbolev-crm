import { normalizeRegistrationPlate, formatRegistrationPlate } from "@/src/domain/registration-plate";
import { normalizePhone } from "@/src/lib/phone";
import { normalizeVin } from "@/src/domain/vin";

const LATIN_TO_VISUAL_CYRILLIC: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  I: "І",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};

function legacyCyrillicPlateVariants(normalizedPlate: string) {
  if (!normalizedPlate) return [];
  const compact = [...normalizedPlate]
    .map((char) => LATIN_TO_VISUAL_CYRILLIC[char] ?? char)
    .join("");
  const variants = new Set<string>([compact]);
  const standard = compact.match(/^(.{2})(\d{4})(.{2})$/u);
  if (standard) variants.add(`${standard[1]} ${standard[2]} ${standard[3]}`);
  return [...variants];
}

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
    for (const variant of legacyCyrillicPlateVariants(plate)) plateValues.add(variant);
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
