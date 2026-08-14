export type VinRegion = "AFRICA" | "ASIA" | "EUROPE" | "NORTH_AMERICA" | "OCEANIA" | "SOUTH_AMERICA" | "UNKNOWN";
export type VinCheckDigitStatus = "VALID" | "INVALID" | "INFORMATIONAL" | "UNAVAILABLE";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const NORTH_AMERICAN_WMI_RE = /^[1-5]/;
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

export function normalizeVin(value: string) {
  return String(value ?? "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

export function vinRegion(vin: string): VinRegion {
  const first = normalizeVin(vin)[0];
  if (!first) return "UNKNOWN";
  if (/[A-H]/.test(first)) return "AFRICA";
  if (/[J-R]/.test(first)) return "ASIA";
  if (/[S-Z]/.test(first)) return "EUROPE";
  if (/[1-5]/.test(first)) return "NORTH_AMERICA";
  if (/[6-7]/.test(first)) return "OCEANIA";
  if (/[8-9]/.test(first)) return "SOUTH_AMERICA";
  return "UNKNOWN";
}

export function calculateVinCheckDigit(rawVin: string): string | null {
  const vin = normalizeVin(rawVin);
  if (!VIN_RE.test(vin)) return null;
  let sum = 0;
  for (let index = 0; index < vin.length; index += 1) {
    const char = vin[index];
    const value = /\d/.test(char) ? Number(char) : VALUES[char];
    if (value == null) return null;
    sum += value * WEIGHTS[index];
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

export function validateVin(rawVin: string) {
  const vin = normalizeVin(rawVin);
  const formatValid = VIN_RE.test(vin);
  const region = vinRegion(vin);
  const wmi = vin.length >= 3 ? vin.slice(0, 3) : null;
  const expectedCheckDigit = formatValid ? calculateVinCheckDigit(vin) : null;
  const actualCheckDigit = formatValid ? vin[8] : null;
  const northAmerican = formatValid && NORTH_AMERICAN_WMI_RE.test(vin);
  const checkDigitMatches = Boolean(expectedCheckDigit && actualCheckDigit && expectedCheckDigit === actualCheckDigit);

  let checkDigitStatus: VinCheckDigitStatus = "UNAVAILABLE";
  if (formatValid && northAmerican) checkDigitStatus = checkDigitMatches ? "VALID" : "INVALID";
  else if (formatValid) checkDigitStatus = checkDigitMatches ? "VALID" : "INFORMATIONAL";

  const warnings: string[] = [];
  if (vin.length !== 17) warnings.push("VIN має містити рівно 17 символів.");
  if (/[IOQ]/i.test(String(rawVin ?? ""))) warnings.push("VIN не може містити літери I, O або Q.");
  if (formatValid && northAmerican && !checkDigitMatches) warnings.push("Контрольна цифра VIN не збігається.");
  if (formatValid && !northAmerican && !checkDigitMatches) warnings.push("Контрольна цифра не підтверджена; для багатьох неамериканських VIN це не є підставою відхиляти номер.");

  return {
    vin,
    valid: formatValid && (!northAmerican || checkDigitMatches),
    formatValid,
    region,
    wmi,
    northAmerican,
    checkDigit: {
      status: checkDigitStatus,
      actual: actualCheckDigit,
      expected: expectedCheckDigit,
      matches: checkDigitMatches,
    },
    warnings,
  };
}
